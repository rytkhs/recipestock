import { MAX_IMAGE_UPLOAD_SIZE_BYTES } from "@recipestock/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecipeImageService, getImageDimensions } from "./images";

const onePixelPng = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

const concatBytes = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }

  return result;
};

const asciiBytes = (value: string) =>
  Uint8Array.from([...value].map((character) => character.charCodeAt(0)));

const uint16BE = (value: number) => Uint8Array.of((value >> 8) & 0xff, value & 0xff);

const uint16LE = (value: number) => Uint8Array.of(value & 0xff, (value >> 8) & 0xff);

const uint24LE = (value: number) =>
  Uint8Array.of(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff);

const uint32LE = (value: number) =>
  Uint8Array.of(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);

const jpegSegment = (marker: number, data: Uint8Array) =>
  concatBytes(Uint8Array.of(0xff, marker), uint16BE(data.byteLength + 2), data);

const jpegSof0Segment = ({ width, height }: { width: number; height: number }) =>
  jpegSegment(
    0xc0,
    Uint8Array.of(
      8,
      ...uint16BE(height),
      ...uint16BE(width),
      3,
      1,
      0x11,
      0,
      2,
      0x11,
      0,
      3,
      0x11,
      0,
    ),
  );

const jpegExifOrientationSegment = (orientation: number) =>
  jpegSegment(
    0xe1,
    concatBytes(
      Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0x00, 0x00),
      asciiBytes("MM"),
      uint16BE(42),
      Uint8Array.of(0, 0, 0, 8),
      uint16BE(1),
      uint16BE(0x0112),
      uint16BE(3),
      Uint8Array.of(0, 0, 0, 1),
      uint16BE(orientation),
      uint16BE(0),
      Uint8Array.of(0, 0, 0, 0),
    ),
  );

const jpegImage = (...segments: Uint8Array[]) =>
  concatBytes(Uint8Array.of(0xff, 0xd8), ...segments, Uint8Array.of(0xff, 0xd9));

const webpChunk = (type: string, data: Uint8Array) =>
  concatBytes(
    asciiBytes(type),
    uint32LE(data.byteLength),
    data,
    data.byteLength % 2 ? Uint8Array.of(0) : new Uint8Array(),
  );

const webpImage = (...chunks: Uint8Array[]) => {
  const body = concatBytes(asciiBytes("WEBP"), ...chunks);

  return concatBytes(asciiBytes("RIFF"), uint32LE(body.byteLength), body);
};

const webpImageWithDeclaredSize = (declaredSize: number, ...chunks: Uint8Array[]) =>
  concatBytes(asciiBytes("RIFF"), uint32LE(declaredSize), asciiBytes("WEBP"), ...chunks);

const webpVp8xImage = ({ width, height }: { width: number; height: number }) =>
  webpImage(
    webpChunk(
      "VP8X",
      concatBytes(Uint8Array.of(0, 0, 0, 0), uint24LE(width - 1), uint24LE(height - 1)),
    ),
  );

const webpVp8lImage = ({ width, height }: { width: number; height: number }) => {
  const encodedWidth = width - 1;
  const encodedHeight = height - 1;

  return webpImage(
    webpChunk(
      "VP8L",
      Uint8Array.of(
        0x2f,
        encodedWidth & 0xff,
        ((encodedWidth >> 8) & 0x3f) | ((encodedHeight & 0x03) << 6),
        (encodedHeight >> 2) & 0xff,
        (encodedHeight >> 10) & 0x0f,
      ),
    ),
  );
};

const webpVp8Image = ({ width, height }: { width: number; height: number }) =>
  webpImage(
    webpChunk(
      "VP8 ",
      Uint8Array.of(0, 0, 0, 0x9d, 0x01, 0x2a, ...uint16LE(width), ...uint16LE(height)),
    ),
  );

const createTestImageService = () => {
  const puts: unknown[] = [];
  const env = {
    RECIPE_IMAGES: {
      get: async () => ({
        body: true,
        size: onePixelPng.byteLength,
        arrayBuffer: async () => onePixelPng.buffer,
        httpMetadata: { contentType: "image/png" },
        customMetadata: {},
      }),
      put: async (key: string, body: unknown, options: unknown) => {
        puts.push({ key, body, options });
      },
    },
  };

  return {
    puts,
    service: createRecipeImageService(
      env as unknown as Parameters<typeof createRecipeImageService>[0],
    ),
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RecipeImageService", () => {
  it("tmp画像の実バイト列から寸法を取得して確定objectへコピーする", async () => {
    const { puts, service } = createTestImageService();

    await expect(
      service.copyObject("tmp/user_123/cover.png", "recipes/user_123/recipe_123/cover.png"),
    ).resolves.toEqual({ width: 1, height: 1 });

    expect(puts).toHaveLength(1);
  });

  it("外部画像URLを取得してcontent-typeに応じた確定objectKeyでR2へ保存する", async () => {
    const { puts, service } = createTestImageService();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(onePixelPng, {
          headers: {
            "content-type": "image/png",
            "content-length": String(onePixelPng.byteLength),
          },
        });
      }),
    );

    await expect(
      service.copyExternalImageUrl?.({
        sourceUrl: "https://cdn.example.com/cover",
        destinationKeyPrefix: "recipes/user_123/recipe_123/cover",
      }),
    ).resolves.toEqual({
      objectKey: "recipes/user_123/recipe_123/cover.png",
      width: 1,
      height: 1,
    });

    expect(puts).toEqual([
      {
        key: "recipes/user_123/recipe_123/cover.png",
        body: expect.any(Uint8Array),
        options: { httpMetadata: { contentType: "image/png" } },
      },
    ]);
  });

  it("外部画像URLのcontent-typeが対応外ならR2へ保存しない", async () => {
    const { puts, service } = createTestImageService();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/gif" },
        });
      }),
    );

    await expect(
      service.copyExternalImageUrl?.({
        sourceUrl: "https://cdn.example.com/cover.gif",
        destinationKeyPrefix: "recipes/user_123/recipe_123/cover",
      }),
    ).rejects.toThrow("External image content type is not supported.");
    expect(puts).toEqual([]);
  });

  it("外部画像URLのContent-Lengthが上限超過なら取得本文を保存しない", async () => {
    const { puts, service } = createTestImageService();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "content-type": "image/webp",
            "content-length": String(MAX_IMAGE_UPLOAD_SIZE_BYTES + 1),
          },
        });
      }),
    );

    await expect(
      service.copyExternalImageUrl?.({
        sourceUrl: "https://cdn.example.com/cover.webp",
        destinationKeyPrefix: "recipes/user_123/recipe_123/cover",
      }),
    ).rejects.toThrow("External image is too large.");
    expect(puts).toEqual([]);
  });

  it("外部画像URLの実読込サイズが上限超過ならR2へ保存しない", async () => {
    const { puts, service } = createTestImageService();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(new Uint8Array(MAX_IMAGE_UPLOAD_SIZE_BYTES + 1), {
          headers: { "content-type": "image/png" },
        });
      }),
    );

    await expect(
      service.copyExternalImageUrl?.({
        sourceUrl: "https://cdn.example.com/cover.png",
        destinationKeyPrefix: "recipes/user_123/recipe_123/cover",
      }),
    ).rejects.toThrow("External image is too large.");
    expect(puts).toEqual([]);
  });

  it("localhostやprivate IP literalの外部画像URLはfetchしない", async () => {
    const { service } = createTestImageService();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const sourceUrl of [
      "http://localhost/image.jpg",
      "http://127.0.0.1/image.jpg",
      "http://10.0.0.1/image.jpg",
      "http://172.16.0.1/image.jpg",
      "http://192.168.0.1/image.jpg",
      "http://[::1]/image.jpg",
      "http://[::ffff:127.0.0.1]/image.jpg",
      "http://[::ffff:10.0.0.1]/image.jpg",
      "http://[::ffff:172.16.0.1]/image.jpg",
      "http://[::ffff:192.168.0.1]/image.jpg",
      "http://[::ffff:169.254.169.254]/image.jpg",
      "http://[::ffff:8.8.8.8]/image.jpg",
    ]) {
      await expect(
        service.copyExternalImageUrl?.({
          sourceUrl,
          destinationKeyPrefix: "recipes/user_123/recipe_123/cover",
        }),
      ).rejects.toThrow("External image URL is not allowed.");
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("外部画像URLのリダイレクト先がblocked hostならR2へ保存しない", async () => {
    const { puts, service } = createTestImageService();
    const fetchMock = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      service.copyExternalImageUrl?.({
        sourceUrl: "https://cdn.example.com/cover.jpg",
        destinationKeyPrefix: "recipes/user_123/recipe_123/cover",
      }),
    ).rejects.toThrow("External image URL is not allowed.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(puts).toEqual([]);
  });
});

describe("getImageDimensions", () => {
  it("PNGのIHDRから寸法を取得する", () => {
    expect(getImageDimensions(onePixelPng)).toEqual({ width: 1, height: 1 });
  });

  it("JPEGのSOF markerから寸法を取得する", () => {
    expect(getImageDimensions(jpegImage(jpegSof0Segment({ width: 640, height: 480 })))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("JPEGのExif orientationが回転系なら寸法を入れ替える", () => {
    expect(
      getImageDimensions(
        jpegImage(jpegExifOrientationSegment(6), jpegSof0Segment({ width: 640, height: 480 })),
      ),
    ).toEqual({
      width: 480,
      height: 640,
    });
  });

  it("WebP VP8X chunkからcanvas寸法を取得する", () => {
    expect(getImageDimensions(webpVp8xImage({ width: 1200, height: 800 }))).toEqual({
      width: 1200,
      height: 800,
    });
  });

  it("WebP VP8L chunkからcanvas寸法を取得する", () => {
    expect(getImageDimensions(webpVp8lImage({ width: 300, height: 200 }))).toEqual({
      width: 300,
      height: 200,
    });
  });

  it("WebP VP8 chunkからcanvas寸法を取得する", () => {
    expect(getImageDimensions(webpVp8Image({ width: 640, height: 360 }))).toEqual({
      width: 640,
      height: 360,
    });
  });

  it("未対応形式は拒否する", () => {
    expect(() => getImageDimensions(Uint8Array.of(1, 2, 3))).toThrow(
      "Image format is not supported.",
    );
  });

  it("truncated headerは拒否する", () => {
    expect(() => getImageDimensions(onePixelPng.slice(0, 12))).toThrow(
      "Image dimensions could not be determined.",
    );
  });

  it("PNGの寸法が0なら拒否する", () => {
    const png = new Uint8Array(onePixelPng);
    png.set(Uint8Array.of(0, 0, 0, 0), 16);

    expect(() => getImageDimensions(png)).toThrow("Image dimensions could not be determined.");
  });

  it("JPEGにSOF markerが無ければ拒否する", () => {
    expect(() => getImageDimensions(jpegImage(jpegSegment(0xe0, asciiBytes("JFIF"))))).toThrow(
      "Image dimensions could not be determined.",
    );
  });

  it("WebPにzero-sized chunkがあれば拒否する", () => {
    const image = webpImage(concatBytes(asciiBytes("JUNK"), uint32LE(0)));

    expect(() => getImageDimensions(image)).toThrow("Image dimensions could not be determined.");
  });

  it("WebP chunkがbody外を指す場合は拒否する", () => {
    const image = webpImage(concatBytes(asciiBytes("JUNK"), uint32LE(10), Uint8Array.of(1)));

    expect(() => getImageDimensions(image)).toThrow("Image dimensions could not be determined.");
  });

  it("WebP chunkがRIFF declared size外にある場合は拒否する", () => {
    const image = webpImageWithDeclaredSize(
      4,
      webpChunk("VP8X", webpVp8xImage({ width: 2, height: 3 }).slice(20)),
    );

    expect(() => getImageDimensions(image)).toThrow("Image dimensions could not be determined.");
  });
});

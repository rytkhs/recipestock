import { describe, expect, it, vi } from "vitest";
import {
  createYtDlpMetadataClient,
  type YtDlpMetadataError,
  type YtDlpMetadataExtractInput,
} from "./ytdlp-metadata";

const extractInput: YtDlpMetadataExtractInput = {
  platform: "instagram",
  url: "https://www.instagram.com/p/DYsxvKyAZMg/",
  timeoutMs: 10_000,
};

describe("YtDlpMetadataClient", () => {
  it("containerを起動して/extractへJSON requestを送る", async () => {
    const startAndWaitForPorts = vi.fn(async () => undefined);
    const fetch = vi.fn(async (_request: Request) =>
      Response.json({
        ok: true,
        source: {
          platform: "instagram",
          canonicalUrl: "https://www.instagram.com/p/DYsxvKyAZMg/",
          shortcode: "DYsxvKyAZMg",
          mediaKind: "post",
        },
        metadata: {
          provider: "yt-dlp",
          extractor: "Instagram",
          webpageUrl: "https://www.instagram.com/p/DYsxvKyAZMg/",
          title: "Post by mizuki_31cafe",
          description: "材料\nなす 5本",
          uploader: null,
          thumbnail: null,
          thumbnails: [],
          duration: null,
          availability: null,
        },
        images: [],
      }),
    );
    const selectContainer = vi.fn(async () => ({ startAndWaitForPorts, fetch }));
    const binding = {} as Parameters<typeof createYtDlpMetadataClient>[0]["binding"];
    const client = createYtDlpMetadataClient({
      binding,
      selectContainer,
      portReadyTimeoutMs: 12_000,
    });

    await expect(client.extract(extractInput)).resolves.toMatchObject({
      source: {
        shortcode: "DYsxvKyAZMg",
      },
      metadata: {
        description: "材料\nなす 5本",
      },
    });

    expect(selectContainer).toHaveBeenCalledWith(binding, 3);
    expect(startAndWaitForPorts).toHaveBeenCalledWith({
      ports: [8080],
      cancellationOptions: {
        portReadyTimeoutMS: 12_000,
      },
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    const request = fetch.mock.calls[0][0];
    expect(new URL(request.url).pathname).toBe("/extract");
    expect(request.method).toBe("POST");
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.signal).toBeInstanceOf(AbortSignal);
    await expect(request.json()).resolves.toEqual(extractInput);
  });

  it("containerのfailure responseをYtDlpMetadataErrorにする", async () => {
    const client = createYtDlpMetadataClient({
      binding: {} as Parameters<typeof createYtDlpMetadataClient>[0]["binding"],
      selectContainer: async () => ({
        startAndWaitForPorts: async () => undefined,
        fetch: async () =>
          Response.json(
            {
              ok: false,
              errorCode: "private_or_login_required",
              message: "Instagram post is private, unavailable, or requires login.",
            },
            { status: 422 },
          ),
      }),
    });

    await expect(client.extract(extractInput)).rejects.toMatchObject({
      code: "private_or_login_required",
    } satisfies Partial<YtDlpMetadataError>);
  });

  it("containerが応答しない場合はtimeoutにする", async () => {
    vi.useFakeTimers();

    try {
      const client = createYtDlpMetadataClient({
        binding: {} as Parameters<typeof createYtDlpMetadataClient>[0]["binding"],
        selectContainer: async () => ({
          startAndWaitForPorts: async () => undefined,
          fetch: async (request) =>
            new Promise<Response>((_resolve, reject) => {
              const containerRequest = request as Request;
              containerRequest.signal.addEventListener("abort", () => {
                reject(new DOMException("The operation was aborted.", "AbortError"));
              });
            }),
        }),
      });

      const promise = client.extract({
        ...extractInput,
        timeoutMs: 10_000,
      });
      const expectation = expect(promise).rejects.toMatchObject({
        code: "timeout",
      } satisfies Partial<YtDlpMetadataError>);

      await vi.advanceTimersByTimeAsync(12_000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});

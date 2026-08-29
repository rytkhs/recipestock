import { describe, expect, it, vi } from "vitest";
import { type RecipeImportError } from "../types";
import {
  createTikTokCanonicalUrl,
  getTikTokUrlTarget,
  tiktokSourceExtractionAdapter,
} from "./tiktok";
import { type SourceExtractionContext } from "./types";

const CONTENT_ID = "7674182074974227730";
const USERNAME = "asu.gohan_";
const VIDEO_URL = `https://www.tiktok.com/@${USERNAME}/video/${CONTENT_ID}`;
const PHOTO_URL = `https://www.tiktok.com/@${USERNAME}/photo/${CONTENT_ID}`;
const EMBED_URL = `https://www.tiktok.com/embed/v2/${CONTENT_ID}`;
const SHORT_URL = "https://vt.tiktok.com/ZSVHJ23b9/";
const COVER_URL = "https://p16-common-sign.tiktokcdn.com/cover~origin.image";
const TIMEOUT_MS = 10_000;

describe("TikTok source extraction URL handling", () => {
  it.each([
    {
      url: VIDEO_URL,
      target: { kind: "post", contentId: CONTENT_ID, username: USERNAME },
    },
    {
      url: PHOTO_URL,
      target: { kind: "post", contentId: CONTENT_ID, username: USERNAME },
    },
    {
      url: `${VIDEO_URL}/`,
      target: { kind: "post", contentId: CONTENT_ID, username: USERNAME },
    },
    {
      url: `${VIDEO_URL}?is_from_webapp=1&sender_device=pc&_r=1&_t=ZS-997lXyspAr1`,
      target: { kind: "post", contentId: CONTENT_ID, username: USERNAME },
    },
    {
      url: `https://tiktok.com/@${USERNAME}/video/${CONTENT_ID}`,
      target: { kind: "post", contentId: CONTENT_ID, username: USERNAME },
    },
    {
      url: `https://m.tiktok.com/@${USERNAME}/video/${CONTENT_ID}`,
      target: { kind: "post", contentId: CONTENT_ID, username: USERNAME },
    },
    {
      url: "https://vt.tiktok.com/ZSVHJ23b9/",
      target: { kind: "short", shortUrl: "https://vt.tiktok.com/ZSVHJ23b9/" },
    },
    {
      url: "https://vm.tiktok.com/ZSVHJ23b9",
      target: { kind: "short", shortUrl: "https://vm.tiktok.com/ZSVHJ23b9/" },
    },
    {
      url: "https://www.tiktok.com/t/ZSVHJ23b9/?_t=abc",
      target: { kind: "short", shortUrl: "https://www.tiktok.com/t/ZSVHJ23b9/" },
    },
    {
      url: "https://tiktok.com/t/ZSVHJ23b9/",
      target: { kind: "short", shortUrl: "https://www.tiktok.com/t/ZSVHJ23b9/" },
    },
  ])("$url からTikTok targetを抽出する", ({ url, target }) => {
    expect(getTikTokUrlTarget(url)).toEqual(target);
    expect(
      tiktokSourceExtractionAdapter.match({
        normalizedUrl: url,
        host: new URL(url).hostname.replace(/^www\./, ""),
      }),
    ).toBe(true);
  });

  it.each([
    `https://www.tiktok.com/@${USERNAME}`,
    "https://www.tiktok.com/tag/レシピ",
    "https://www.tiktok.com/live",
    `https://www.tiktok.com/@${USERNAME}/live/${CONTENT_ID}`,
    `https://www.tiktok.com/${USERNAME}/video/${CONTENT_ID}`,
    `https://www.tiktok.com/@${USERNAME}/video/abc`,
    `https://www.tiktok.com/@user-name/video/${CONTENT_ID}`,
    `https://www.tiktok.com/@${USERNAME}/video/${CONTENT_ID}/extra`,
    `http://www.tiktok.com/@${USERNAME}/video/${CONTENT_ID}`,
    `https://www.tiktok.com:444/@${USERNAME}/video/${CONTENT_ID}`,
    `https://user@www.tiktok.com/@${USERNAME}/video/${CONTENT_ID}`,
    "https://vt.tiktok.com/ZSVHJ23b9/extra/",
    "https://vt.tiktok.com/ZS-VHJ/",
    "https://tiktok.com.example.com/@user/video/123",
    "not-a-url",
  ])("対象外URLにはmatchしない: %s", (url) => {
    expect(getTikTokUrlTarget(url)).toBeNull();
    expect(
      tiktokSourceExtractionAdapter.match({
        normalizedUrl: url,
        host: "tiktok.com",
      }),
    ).toBe(false);
  });

  it("canonical URLをmediaKindごとに組み立てる", () => {
    expect(
      createTikTokCanonicalUrl({ username: USERNAME, mediaKind: "video", contentId: CONTENT_ID }),
    ).toBe(VIDEO_URL);
    expect(
      createTikTokCanonicalUrl({ username: USERNAME, mediaKind: "photo", contentId: CONTENT_ID }),
    ).toBe(PHOTO_URL);
  });
});

describe("TikTok source extraction adapter", () => {
  it("video投稿からAI inputとカバー画像配置を作る", async () => {
    const fetchHtml = createFetchHtml(
      createTikTokEmbedHtml(
        createTikTokVideoData({
          text: "材料\n鶏もも肉 1枚\n作り方\n焼く",
          coversOrigin: [COVER_URL],
        }),
      ),
    );
    const result = await tiktokSourceExtractionAdapter.extract(createContext({ fetchHtml }));

    expect(fetchHtml).toHaveBeenCalledTimes(1);
    expect(fetchHtml).toHaveBeenCalledWith(EMBED_URL);
    expect(result).toEqual({
      promptProfile: "social",
      input: {
        source: {
          finalUrl: VIDEO_URL,
          host: "tiktok.com",
        },
        markdownContent: [
          `# Post by ${USERNAME}`,
          "",
          "Source: TikTok",
          `URL: ${VIDEO_URL}`,
          `Author: ${USERNAME}`,
          "",
          "## Caption",
          "",
          "材料\n鶏もも肉 1枚\n作り方\n焼く",
        ].join("\n"),
      },
      imageCandidates: [
        {
          id: "tiktok_cover",
          url: COVER_URL,
          alt: `Post by ${USERNAME} cover`,
          position: 0,
        },
      ],
      imagePlacement: {
        coverImageUrl: COVER_URL,
        referenceImageUrls: [],
      },
      source: {
        sourceUrl: VIDEO_URL,
        sourceName: "TikTok",
      },
      warnings: [],
    });
    expect(result.input.markdownContent).not.toContain(COVER_URL);
  });

  it("coversOriginが無ければcoversをカバーに使う", async () => {
    const result = await tiktokSourceExtractionAdapter.extract(
      createContext({
        fetchHtml: createFetchHtml(
          createTikTokEmbedHtml(
            createTikTokVideoData({
              text: "材料\n卵 2個",
              coversOrigin: [],
              covers: ["https://cdn.example.com/fallback.jpeg"],
            }),
          ),
        ),
      }),
    );

    expect(result.imagePlacement).toEqual({
      coverImageUrl: "https://cdn.example.com/fallback.jpeg",
      referenceImageUrls: [],
    });
  });

  it("photo carouselでは全画像を順序どおりreferenceImagesにし先頭をカバーにする", async () => {
    const result = await tiktokSourceExtractionAdapter.extract(
      createContext({
        normalizedUrl: PHOTO_URL,
        fetchHtml: createFetchHtml(
          createTikTokEmbedHtml(
            createTikTokVideoData({
              text: "作り置き5品",
              coversOrigin: [COVER_URL],
              displayImages: [
                "https://cdn.example.com/1.jpeg",
                "https://cdn.example.com/2.jpeg",
                "https://cdn.example.com/3.jpeg",
              ],
            }),
          ),
        ),
      }),
    );

    expect(result.source.sourceUrl).toBe(PHOTO_URL);
    expect(result.imageCandidates).toEqual([
      {
        id: "tiktok_image_0",
        url: "https://cdn.example.com/1.jpeg",
        alt: `Post by ${USERNAME} image 1`,
        position: 0,
      },
      {
        id: "tiktok_image_1",
        url: "https://cdn.example.com/2.jpeg",
        alt: `Post by ${USERNAME} image 2`,
        position: 1,
      },
      {
        id: "tiktok_image_2",
        url: "https://cdn.example.com/3.jpeg",
        alt: `Post by ${USERNAME} image 3`,
        position: 2,
      },
    ]);
    expect(result.imagePlacement).toEqual({
      coverImageUrl: "https://cdn.example.com/1.jpeg",
      referenceImageUrls: [
        "https://cdn.example.com/1.jpeg",
        "https://cdn.example.com/2.jpeg",
        "https://cdn.example.com/3.jpeg",
      ],
    });
  });

  it("displayImagesがあればURLパスに関わらずphotoとしてcanonicalを組み立てる", async () => {
    const result = await tiktokSourceExtractionAdapter.extract(
      createContext({
        normalizedUrl: VIDEO_URL,
        fetchHtml: createFetchHtml(
          createTikTokEmbedHtml(
            createTikTokVideoData({
              text: "作り置き",
              displayImages: ["https://cdn.example.com/1.jpeg"],
            }),
          ),
        ),
      }),
    );

    expect(result.source.sourceUrl).toBe(PHOTO_URL);
  });

  it("photo carouselはcaptionが空でも画像だけで成功する", async () => {
    const result = await tiktokSourceExtractionAdapter.extract(
      createContext({
        normalizedUrl: PHOTO_URL,
        fetchHtml: createFetchHtml(
          createTikTokEmbedHtml(
            createTikTokVideoData({
              text: "   ",
              displayImages: ["https://cdn.example.com/1.jpeg"],
            }),
          ),
        ),
      }),
    );

    expect(result.input.markdownContent).toBe(
      [`# Post by ${USERNAME}`, "", "Source: TikTok", `URL: ${PHOTO_URL}`, `Author: ${USERNAME}`]
        .join("\n")
        .trim(),
    );
    expect(result.imagePlacement).toEqual({
      coverImageUrl: "https://cdn.example.com/1.jpeg",
      referenceImageUrls: ["https://cdn.example.com/1.jpeg"],
    });
  });

  it("同一画像が重複してもreferenceImagesを重複させない", async () => {
    const result = await tiktokSourceExtractionAdapter.extract(
      createContext({
        normalizedUrl: PHOTO_URL,
        fetchHtml: createFetchHtml(
          createTikTokEmbedHtml(
            createTikTokVideoData({
              text: "作り置き",
              displayImages: ["https://cdn.example.com/1.jpeg", "https://cdn.example.com/1.jpeg"],
            }),
          ),
        ),
      }),
    );

    expect(result.imagePlacement?.referenceImageUrls).toEqual(["https://cdn.example.com/1.jpeg"]);
  });

  it("canonical URLはURLのusernameではなくuniqueIdを使う", async () => {
    const result = await tiktokSourceExtractionAdapter.extract(
      createContext({
        normalizedUrl: `https://www.tiktok.com/@spoofed.user/video/${CONTENT_ID}`,
        fetchHtml: createFetchHtml(
          createTikTokEmbedHtml(createTikTokVideoData({ text: "材料\n卵 2個" })),
        ),
      }),
    );

    expect(result.source.sourceUrl).toBe(VIDEO_URL);
  });

  it("uniqueIdが無ければURLのusernameでcanonicalを組み立ててnickNameをauthorにする", async () => {
    const result = await tiktokSourceExtractionAdapter.extract(
      createContext({
        fetchHtml: createFetchHtml(
          createTikTokEmbedHtml(
            createTikTokVideoData({ text: "材料\n卵 2個", uniqueId: "", nickName: "あす" }),
          ),
        ),
      }),
    );

    expect(result.source.sourceUrl).toBe(VIDEO_URL);
    expect(result.input.markdownContent).toContain("# Post by あす");
    expect(result.input.markdownContent).toContain("Author: あす");
  });

  it("短縮URLをwatch URLに解決してからembedを取得する", async () => {
    const fetchHtml = vi.fn(async (url: string) => {
      if (url === SHORT_URL) {
        return {
          finalUrl: `${VIDEO_URL}?_r=1&_t=ZS-997lXyspAr1`,
          contentType: "text/html",
          body: "<html><head></head><body></body></html>",
        };
      }

      return {
        finalUrl: url,
        contentType: "text/html",
        body: createTikTokEmbedHtml(createTikTokVideoData({ text: "材料\n卵 2個" })),
      };
    });
    const result = await tiktokSourceExtractionAdapter.extract(
      createContext({ normalizedUrl: SHORT_URL, fetchHtml }),
    );

    expect(fetchHtml.mock.calls.map(([url]) => url)).toEqual([SHORT_URL, EMBED_URL]);
    expect(result.source.sourceUrl).toBe(VIDEO_URL);
  });

  it("短縮URLが投稿URLに解決しない場合はextraction_failedにする", async () => {
    await expect(
      tiktokSourceExtractionAdapter.extract(
        createContext({
          normalizedUrl: SHORT_URL,
          fetchHtml: vi.fn(async () => ({
            finalUrl: `https://www.tiktok.com/@${USERNAME}`,
            contentType: "text/html",
            body: "<html><head></head><body></body></html>",
          })),
        }),
      ),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("__FRONTITY_CONNECT_STATE__がない場合はextraction_failedにする", async () => {
    await expect(
      tiktokSourceExtractionAdapter.extract(
        createContext({
          fetchHtml: createFetchHtml("<html><head></head><body>no state</body></html>"),
        }),
      ),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("HTTP 200でもエラーページの場合はextraction_failedにする", async () => {
    await expect(
      tiktokSourceExtractionAdapter.extract(
        createContext({
          fetchHtml: createFetchHtml(
            createTikTokEmbedHtml(undefined, {
              isError: true,
              errorCode: 10204,
              pageName: "video_v2_error",
            }),
          ),
        }),
      ),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("itemInfos.idがリクエストしたidと一致しない場合はextraction_failedにする", async () => {
    await expect(
      tiktokSourceExtractionAdapter.extract(
        createContext({
          fetchHtml: createFetchHtml(
            createTikTokEmbedHtml(
              createTikTokVideoData({ id: "7000000000000000000", text: "材料\n卵 2個" }),
            ),
          ),
        }),
      ),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("videoで画像もcaptionも無い場合はextraction_failedにする", async () => {
    await expect(
      tiktokSourceExtractionAdapter.extract(
        createContext({
          fetchHtml: createFetchHtml(
            createTikTokEmbedHtml(
              createTikTokVideoData({ text: "   ", coversOrigin: [COVER_URL] }),
            ),
          ),
        }),
      ),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });
});

const createContext = (
  overrides: Partial<SourceExtractionContext> = {},
): SourceExtractionContext => ({
  normalizedUrl: VIDEO_URL,
  host: "tiktok.com",
  timeoutMs: TIMEOUT_MS,
  fetchHtml: createFetchHtml(
    createTikTokEmbedHtml(createTikTokVideoData({ text: "材料\n卵 2個" })),
  ),
  ...overrides,
});

const createFetchHtml = (html: string) =>
  vi.fn(async (url: string) => ({
    finalUrl: url,
    contentType: "text/html",
    body: html,
  }));

const createTikTokVideoData = ({
  id = CONTENT_ID,
  text = "",
  uniqueId = USERNAME,
  nickName = "あす",
  covers = [],
  coversOrigin = [],
  displayImages,
}: {
  id?: string;
  text?: string;
  uniqueId?: string;
  nickName?: string;
  covers?: string[];
  coversOrigin?: string[];
  displayImages?: string[];
} = {}) => ({
  itemInfos: {
    id,
    text,
    covers,
    coversOrigin,
  },
  authorInfos: {
    uniqueId,
    nickName,
  },
  ...(displayImages
    ? {
        imagePostInfo: {
          displayImages: displayImages.map((url) => ({
            height: 1574,
            width: 1180,
            urlList: [url],
          })),
        },
      }
    : {}),
});

const createTikTokEmbedHtml = (
  videoData: unknown,
  entryOverrides: Record<string, unknown> = { code: 200, isError: false, pageName: "video_v2" },
) => {
  const state = {
    source: {
      data: {
        [`/embed/v2/${CONTENT_ID}`]: {
          route: `/embed/v2/${CONTENT_ID}`,
          ...(videoData ? { videoData } : {}),
          ...entryOverrides,
        },
        strategy: {},
      },
    },
  };

  return [
    "<html><head></head><body>",
    `<script id="__FRONTITY_CONNECT_STATE__" type="application/json">${JSON.stringify(state)}</script>`,
    "</body></html>",
  ].join("");
};

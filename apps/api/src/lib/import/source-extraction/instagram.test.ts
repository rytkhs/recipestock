import { describe, expect, it, vi } from "vitest";
import {
  type YtDlpMetadata,
  type YtDlpMetadataClient,
  YtDlpMetadataError,
} from "../../../ytdlp-metadata";
import { type RecipeImportError } from "../types";
import {
  createInstagramCanonicalUrl,
  getInstagramSource,
  instagramSourceExtractionAdapter,
} from "./instagram";
import { type SourceExtractionContext } from "./types";

const CANONICAL_URL = "https://www.instagram.com/p/DYsxvKyAZMg/";
const SHORTCODE = "DYsxvKyAZMg";
const TIMEOUT_MS = 10_000;

describe("Instagram source extraction URL handling", () => {
  it.each([
    {
      url: "https://www.instagram.com/p/DYsxvKyAZMg/?hl=ja",
      canonicalUrl: "https://www.instagram.com/p/DYsxvKyAZMg/",
      shortcode: "DYsxvKyAZMg",
      mediaKind: "post",
    },
    {
      url: "https://www.instagram.com/reel/C9QigGTgKZf/?hl=ja",
      canonicalUrl: "https://www.instagram.com/reel/C9QigGTgKZf/",
      shortcode: "C9QigGTgKZf",
      mediaKind: "reel",
    },
    {
      url: "https://www.instagram.com/p/DZ0zsw3k2r6/?utm_source=ig_web_copy_link&igsh=NTc4MTIwNjQ2YQ==",
      canonicalUrl: "https://www.instagram.com/p/DZ0zsw3k2r6/",
      shortcode: "DZ0zsw3k2r6",
      mediaKind: "post",
    },
    {
      url: "https://instagram.com/p/DYsxvKyAZMg/",
      canonicalUrl: "https://www.instagram.com/p/DYsxvKyAZMg/",
      shortcode: "DYsxvKyAZMg",
      mediaKind: "post",
    },
    {
      url: "https://www.instagram.com/p/DYsxvKyAZMg/#comments",
      canonicalUrl: "https://www.instagram.com/p/DYsxvKyAZMg/",
      shortcode: "DYsxvKyAZMg",
      mediaKind: "post",
    },
    {
      url: "https://www.instagram.com/some.user/reel/CWqAgUZgCku/",
      canonicalUrl: "https://www.instagram.com/reel/CWqAgUZgCku/",
      shortcode: "CWqAgUZgCku",
      mediaKind: "reel",
    },
    {
      url: "https://instagram.com/some_user/p/DYsxvKyAZMg/?hl=ja",
      canonicalUrl: "https://www.instagram.com/p/DYsxvKyAZMg/",
      shortcode: "DYsxvKyAZMg",
      mediaKind: "post",
    },
    {
      url: "https://www.instagram.com/reels/Cop84x6u7CP/",
      canonicalUrl: "https://www.instagram.com/reel/Cop84x6u7CP/",
      shortcode: "Cop84x6u7CP",
      mediaKind: "reel",
    },
    {
      url: "https://www.instagram.com/some.user/reels/Cop84x6u7CP/",
      canonicalUrl: "https://www.instagram.com/reel/Cop84x6u7CP/",
      shortcode: "Cop84x6u7CP",
      mediaKind: "reel",
    },
  ])("$url からInstagram sourceを抽出する", ({ url, canonicalUrl, shortcode, mediaKind }) => {
    expect(getInstagramSource(url)).toEqual({
      canonicalUrl,
      shortcode,
      mediaKind,
    });
    expect(
      instagramSourceExtractionAdapter.match({
        normalizedUrl: url,
        host: new URL(url).hostname.replace(/^www\./, ""),
      }),
    ).toBe(true);
  });

  it.each([
    ["post", "DYsxvKyAZMg", "https://www.instagram.com/p/DYsxvKyAZMg/"],
    ["reel", "C9QigGTgKZf", "https://www.instagram.com/reel/C9QigGTgKZf/"],
  ] as const)("canonical URLを生成する", (mediaKind, shortcode, expected) => {
    expect(createInstagramCanonicalUrl({ mediaKind, shortcode })).toBe(expected);
  });

  it.each([
    "http://www.instagram.com/p/DYsxvKyAZMg/",
    "https://m.instagram.com/p/DYsxvKyAZMg/",
    "https://www.instagram.com/stories/mizuki_31cafe/123456789/",
    "https://www.instagram.com/explore/tags/recipe/",
    "https://www.instagram.com/tv/BkfuX9UB-eK/",
    "https://www.instagram.com/user/tv/BkfuX9UB-eK/",
    "https://www.instagram.com/reels/audio/123/",
    "https://www.instagram.com/p/",
    "https://www.instagram.com/p/DYsxvKyAZMg*/",
    "https://www.instagram.com:444/p/DYsxvKyAZMg/",
    "https://user@www.instagram.com/p/DYsxvKyAZMg/",
    "https://www.instagram.com/p/DYsxvKyAZMg/extra/",
    "https://www.instagram.com/some-user/reel/CWqAgUZgCku/",
    "not-a-url",
  ])("対象外URLにはmatchしない: %s", (url) => {
    expect(getInstagramSource(url)).toBeNull();
    expect(
      instagramSourceExtractionAdapter.match({
        normalizedUrl: url,
        host: "instagram.com",
      }),
    ).toBe(false);
  });
});

describe("Instagram source extraction adapter", () => {
  it("yt-dlp metadataからAI inputと画像候補を作る", async () => {
    const ytdlpMetadataClient = createYtDlpMetadataClientStub(
      createYtDlpMetadata({
        metadata: {
          title: "Post by mizuki_31cafe",
          description: "材料\nなす 5本\n作り方\n揚げ焼きにする",
          uploader: "mizuki_31cafe",
        },
        images: [
          {
            url: "https://cdn.example.com/cover.jpg",
            kind: "thumbnail",
            source: "top_level",
            width: 1080,
            height: 1080,
          },
          {
            url: "https://cdn.example.com/cover.jpg",
            kind: "thumbnail",
            source: "entry",
            entryIndex: 0,
          },
          {
            url: "https://cdn.example.com/step.jpg",
            kind: "thumbnail",
            source: "entry",
            entryIndex: 1,
          },
        ],
      }),
    );

    const result = await instagramSourceExtractionAdapter.extract(
      createContext({ ytdlpMetadataClient }),
    );

    expect(ytdlpMetadataClient.extract).toHaveBeenCalledWith({
      platform: "instagram",
      url: CANONICAL_URL,
      timeoutMs: TIMEOUT_MS,
    });
    expect(result).toEqual({
      input: {
        source: {
          finalUrl: CANONICAL_URL,
          host: "instagram.com",
        },
        markdownContent: [
          "# Post by mizuki_31cafe",
          "",
          "Source: Instagram",
          `URL: ${CANONICAL_URL}`,
          "Author: mizuki_31cafe",
          "",
          "## Caption",
          "",
          "材料\nなす 5本\n作り方\n揚げ焼きにする",
        ].join("\n"),
        recipeStructuredEvidence: [],
      },
      imageCandidates: [
        {
          id: "instagram_image_0",
          url: "https://cdn.example.com/cover.jpg",
          alt: "Post by mizuki_31cafe image 1",
          position: 0,
        },
        {
          id: "instagram_image_1",
          url: "https://cdn.example.com/step.jpg",
          alt: "Post by mizuki_31cafe image 2",
          position: 1,
        },
      ],
      imagePlacement: {
        coverImageUrl: "https://cdn.example.com/cover.jpg",
        prependedStepImageUrls: [
          "https://cdn.example.com/cover.jpg",
          "https://cdn.example.com/step.jpg",
        ],
      },
      source: {
        sourceUrl: CANONICAL_URL,
        sourceName: "Instagram",
      },
      warnings: [],
    });
  });

  it("画像0件でもcaptionがあれば成功する", async () => {
    const result = await instagramSourceExtractionAdapter.extract(
      createContext({
        ytdlpMetadataClient: createYtDlpMetadataClientStub(
          createYtDlpMetadata({
            metadata: {
              title: null,
              description: "材料\n卵 2個",
              uploader: null,
            },
            images: [],
          }),
        ),
      }),
    );

    expect(result.input.markdownContent).toBe(
      [
        "# Instagram post",
        "",
        "Source: Instagram",
        `URL: ${CANONICAL_URL}`,
        "",
        "## Caption",
        "",
        "材料\n卵 2個",
      ].join("\n"),
    );
    expect(result.imageCandidates).toEqual([]);
    expect(result.imagePlacement).toEqual({
      prependedStepImageUrls: [],
    });
  });

  it("yt-dlp metadata client未設定はunknownにする", async () => {
    await expect(instagramSourceExtractionAdapter.extract(createContext())).rejects.toMatchObject({
      code: "unknown",
    } satisfies Partial<RecipeImportError>);
  });

  it("captionが空の場合はextraction_failedにする", async () => {
    await expect(
      instagramSourceExtractionAdapter.extract(
        createContext({
          ytdlpMetadataClient: createYtDlpMetadataClientStub(
            createYtDlpMetadata({
              metadata: {
                description: "   ",
              },
            }),
          ),
        }),
      ),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("metadata identityが一致しない場合はextraction_failedにする", async () => {
    await expect(
      instagramSourceExtractionAdapter.extract(
        createContext({
          ytdlpMetadataClient: createYtDlpMetadataClientStub(
            createYtDlpMetadata({
              source: {
                canonicalUrl: "https://www.instagram.com/p/OTHER/",
                shortcode: "OTHER",
                mediaKind: "post",
              },
            }),
          ),
        }),
      ),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("yt-dlp private/login failureはprivate_or_login_requiredにする", async () => {
    await expect(
      instagramSourceExtractionAdapter.extract(
        createContext({
          ytdlpMetadataClient: createYtDlpMetadataClientErrorStub(
            new YtDlpMetadataError(
              "private_or_login_required",
              "Instagram post is private, unavailable, or requires login.",
            ),
          ),
        }),
      ),
    ).rejects.toMatchObject({
      code: "private_or_login_required",
    } satisfies Partial<RecipeImportError>);
  });

  it("yt-dlp timeoutはfetch_failedに丸める", async () => {
    await expect(
      instagramSourceExtractionAdapter.extract(
        createContext({
          ytdlpMetadataClient: createYtDlpMetadataClientErrorStub(
            new YtDlpMetadataError("timeout", "yt-dlp metadata request timed out."),
          ),
        }),
      ),
    ).rejects.toMatchObject({
      code: "fetch_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("yt-dlp invalid_requestはinvalid_urlに丸める", async () => {
    await expect(
      instagramSourceExtractionAdapter.extract(
        createContext({
          ytdlpMetadataClient: createYtDlpMetadataClientErrorStub(
            new YtDlpMetadataError("invalid_request", "Instagram URL is invalid."),
          ),
        }),
      ),
    ).rejects.toMatchObject({
      code: "invalid_url",
    } satisfies Partial<RecipeImportError>);
  });
});

const createContext = (
  overrides: Partial<SourceExtractionContext> = {},
): SourceExtractionContext => ({
  normalizedUrl: CANONICAL_URL,
  host: "instagram.com",
  timeoutMs: TIMEOUT_MS,
  async fetchHtml() {
    throw new Error("Instagram adapter should not fetch HTML.");
  },
  ...overrides,
});

const createYtDlpMetadataClientStub = (metadata: YtDlpMetadata): YtDlpMetadataClient => ({
  extract: vi.fn(async () => metadata),
});

const createYtDlpMetadataClientErrorStub = (error: Error): YtDlpMetadataClient => ({
  extract: vi.fn(async () => {
    throw error;
  }),
});

const createYtDlpMetadata = ({
  source = {},
  metadata = {},
  images = [],
}: {
  source?: Partial<YtDlpMetadata["source"]>;
  metadata?: Partial<YtDlpMetadata["metadata"]>;
  images?: YtDlpMetadata["images"];
} = {}): YtDlpMetadata => ({
  ok: true,
  source: {
    platform: "instagram",
    canonicalUrl: CANONICAL_URL,
    shortcode: SHORTCODE,
    mediaKind: "post",
    ...source,
  },
  metadata: {
    provider: "yt-dlp",
    extractor: "Instagram",
    webpageUrl: CANONICAL_URL,
    title: "Post by mizuki_31cafe",
    description: "材料\nなす 5本",
    uploader: "mizuki_31cafe",
    thumbnail: null,
    thumbnails: [],
    duration: null,
    availability: null,
    ...metadata,
  },
  images,
});

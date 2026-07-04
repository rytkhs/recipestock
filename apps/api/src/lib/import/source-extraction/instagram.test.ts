import { describe, expect, it, vi } from "vitest";
import { type RecipeImportError } from "../types";
import {
  createInstagramCanonicalUrl,
  getInstagramSource,
  instagramSourceExtractionAdapter,
} from "./instagram";
import { type SourceExtractionContext } from "./types";

const CANONICAL_URL = "https://www.instagram.com/p/DYsxvKyAZMg/";
const EMBED_URL = "https://www.instagram.com/p/DYsxvKyAZMg/embed/";
const REEL_CANONICAL_URL = "https://www.instagram.com/reel/C9QigGTgKZf/";
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
  it("embed HTMLからAI inputと単一画像配置を作る", async () => {
    const fetchHtml = createFetchHtml(
      createInstagramEmbedHtml({
        shortcode_media: createInstagramMedia({
          caption: "材料\nなす 5本\n作り方\n揚げ焼きにする",
          displayResources: [
            { src: "https://cdn.example.com/small.jpg", config_width: 320, config_height: 320 },
            { src: "https://cdn.example.com/cover.jpg", config_width: 1080, config_height: 1080 },
          ],
        }),
      }),
    );
    const ytdlpMetadataClient = {
      extract: vi.fn(async () => {
        throw new Error("yt-dlp should not be called.");
      }),
    };

    const result = await instagramSourceExtractionAdapter.extract(
      createContext({ fetchHtml, ytdlpMetadataClient }),
    );

    expect(fetchHtml).toHaveBeenCalledWith(EMBED_URL);
    expect(ytdlpMetadataClient.extract).not.toHaveBeenCalled();
    expect(result).toEqual({
      promptProfile: "social",
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
      },
      imageCandidates: [
        {
          id: "instagram_image_0",
          url: "https://cdn.example.com/cover.jpg",
          alt: "Post by mizuki_31cafe image 1",
          position: 0,
        },
      ],
      imagePlacement: {
        coverImageUrl: "https://cdn.example.com/cover.jpg",
        referenceImageUrls: ["https://cdn.example.com/cover.jpg"],
      },
      source: {
        sourceUrl: CANONICAL_URL,
        sourceName: "Instagram",
      },
      warnings: [],
    });
    expect(result.input.markdownContent).not.toContain("https://cdn.example.com/cover.jpg");
  });

  it("画像0件でもcaptionがあれば成功する", async () => {
    const result = await instagramSourceExtractionAdapter.extract(
      createContext({
        fetchHtml: createFetchHtml(
          createInstagramEmbedHtml({
            shortcode_media: createInstagramMedia({
              caption: "材料\n卵 2個",
              displayUrl: null,
              ownerUsername: null,
            }),
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
      referenceImageUrls: [],
    });
  });

  it("carouselの画像childを順序通りreferenceImagesへ追加する", async () => {
    const result = await instagramSourceExtractionAdapter.extract(
      createContext({
        fetchHtml: createFetchHtml(
          createInstagramEmbedHtml({
            shortcode_media: createInstagramMedia({
              children: [
                createInstagramMediaNode({ displayUrl: "https://cdn.example.com/sidecar-1.jpg" }),
                createInstagramMediaNode({ displayUrl: "https://cdn.example.com/sidecar-2.jpg" }),
              ],
            }),
          }),
        ),
      }),
    );

    expect(result.imageCandidates).toEqual([
      {
        id: "instagram_image_0",
        url: "https://cdn.example.com/sidecar-1.jpg",
        alt: "Post by mizuki_31cafe image 1",
        position: 0,
      },
      {
        id: "instagram_image_1",
        url: "https://cdn.example.com/sidecar-2.jpg",
        alt: "Post by mizuki_31cafe image 2",
        position: 1,
      },
    ]);
    expect(result.imagePlacement).toEqual({
      coverImageUrl: "https://cdn.example.com/sidecar-1.jpg",
      referenceImageUrls: [
        "https://cdn.example.com/sidecar-1.jpg",
        "https://cdn.example.com/sidecar-2.jpg",
      ],
    });
  });

  it("mixed carouselでは動画childをreferenceImagesとimageCandidatesから除外して先頭動画coverをcoverにする", async () => {
    const result = await instagramSourceExtractionAdapter.extract(
      createContext({
        fetchHtml: createFetchHtml(
          createInstagramEmbedHtml({
            shortcode_media: createInstagramMedia({
              children: [
                createInstagramMediaNode({
                  isVideo: true,
                  displayUrl: "https://cdn.example.com/video-cover.jpg",
                }),
                createInstagramMediaNode({ displayUrl: "https://cdn.example.com/sidecar-1.jpg" }),
                createInstagramMediaNode({ displayUrl: "https://cdn.example.com/sidecar-2.jpg" }),
              ],
            }),
          }),
        ),
      }),
    );

    expect(result.imageCandidates.map((candidate) => candidate.url)).toEqual([
      "https://cdn.example.com/sidecar-1.jpg",
      "https://cdn.example.com/sidecar-2.jpg",
    ]);
    expect(result.imagePlacement).toEqual({
      coverImageUrl: "https://cdn.example.com/video-cover.jpg",
      referenceImageUrls: [
        "https://cdn.example.com/sidecar-1.jpg",
        "https://cdn.example.com/sidecar-2.jpg",
      ],
    });
  });

  it("Reelではカバー画像だけを配置する", async () => {
    const result = await instagramSourceExtractionAdapter.extract(
      createContext({
        normalizedUrl: REEL_CANONICAL_URL,
        fetchHtml: createFetchHtml(
          createInstagramEmbedHtml({
            shortcode_media: createInstagramMedia({
              isVideo: true,
              displayUrl: "https://cdn.example.com/reel-cover.jpg",
            }),
          }),
        ),
      }),
    );

    expect(result.input.source.finalUrl).toBe(REEL_CANONICAL_URL);
    expect(result.imageCandidates).toEqual([]);
    expect(result.imagePlacement).toEqual({
      coverImageUrl: "https://cdn.example.com/reel-cover.jpg",
      referenceImageUrls: [],
    });
  });

  it("単一動画投稿ではカバー画像だけを配置する", async () => {
    const result = await instagramSourceExtractionAdapter.extract(
      createContext({
        fetchHtml: createFetchHtml(
          createInstagramEmbedHtml({
            shortcode_media: createInstagramMedia({
              isVideo: true,
              displayUrl: "https://cdn.example.com/video-cover.jpg",
            }),
          }),
        ),
      }),
    );

    expect(result.imageCandidates).toEqual([]);
    expect(result.imagePlacement).toEqual({
      coverImageUrl: "https://cdn.example.com/video-cover.jpg",
      referenceImageUrls: [],
    });
  });

  it("login/challenge文字列があってもshortcode_mediaがあれば成功する", async () => {
    const result = await instagramSourceExtractionAdapter.extract(
      createContext({
        fetchHtml: createFetchHtml(
          createInstagramEmbedHtml({
            shortcode_media: createInstagramMedia(),
            bodyPrefix: "login checkpoint challenge",
          }),
        ),
      }),
    );

    expect(result.input.markdownContent).toContain("材料\nなす 5本");
  });

  it("double-quoted属性のcontextJSONでcaption内のapostropheを許容する", async () => {
    const caption = "Don't skip the sauce\n材料\nトマト 2個";
    const contextJSON = JSON.stringify({
      gql_data: {
        shortcode_media: createInstagramMedia({ caption }),
      },
    });
    const html = `<html><body><blockquote contextJSON="${escapeHtmlAttribute(
      contextJSON,
    )}"></blockquote></body></html>`;

    const result = await instagramSourceExtractionAdapter.extract(
      createContext({
        fetchHtml: createFetchHtml(html),
      }),
    );

    expect(result.input.markdownContent).toContain(caption);
  });

  it("contextJSONがない場合はextraction_failedにする", async () => {
    await expect(
      instagramSourceExtractionAdapter.extract(
        createContext({
          fetchHtml: createFetchHtml("<html><body>No context JSON</body></html>"),
        }),
      ),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("shortcode_mediaがない場合はextraction_failedにする", async () => {
    await expect(
      instagramSourceExtractionAdapter.extract(
        createContext({
          fetchHtml: createFetchHtml(createInstagramEmbedHtml({ gql_data: {} })),
        }),
      ),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("shortcode_mediaがなくlogin/checkpoint HTMLの場合はprivate_or_login_requiredにする", async () => {
    await expect(
      instagramSourceExtractionAdapter.extract(
        createContext({
          fetchHtml: createFetchHtml(
            "<html><body>Please login. checkpoint required.</body></html>",
          ),
        }),
      ),
    ).rejects.toMatchObject({
      code: "private_or_login_required",
    } satisfies Partial<RecipeImportError>);
  });

  it("captionが空の場合はextraction_failedにする", async () => {
    await expect(
      instagramSourceExtractionAdapter.extract(
        createContext({
          fetchHtml: createFetchHtml(
            createInstagramEmbedHtml({
              shortcode_media: createInstagramMedia({ caption: "   " }),
            }),
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
  normalizedUrl: CANONICAL_URL,
  host: "instagram.com",
  timeoutMs: TIMEOUT_MS,
  fetchHtml: createFetchHtml(createInstagramEmbedHtml({ shortcode_media: createInstagramMedia() })),
  ...overrides,
});

const createFetchHtml = (html: string) =>
  vi.fn(async (url: string) => ({
    finalUrl: url,
    contentType: "text/html",
    body: html,
  }));

const createInstagramEmbedHtml = ({
  shortcode_media,
  gql_data = { shortcode_media },
  bodyPrefix = "",
}: {
  shortcode_media?: Record<string, unknown>;
  gql_data?: Record<string, unknown>;
  bodyPrefix?: string;
}) => {
  const outerPayload = {
    contextJSON: JSON.stringify({ gql_data }),
  };

  return `<html><body>${bodyPrefix}<script type="application/json">${JSON.stringify(
    outerPayload,
  )}</script></body></html>`;
};

const escapeHtmlAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const createInstagramMedia = ({
  caption = "材料\nなす 5本",
  ownerUsername = "mizuki_31cafe",
  displayUrl = "https://cdn.example.com/cover.jpg",
  displayResources,
  isVideo = false,
  children = [],
}: {
  caption?: string;
  ownerUsername?: string | null;
  displayUrl?: string | null;
  displayResources?: Array<{ src: string; config_width: number; config_height: number }>;
  isVideo?: boolean;
  children?: Array<Record<string, unknown>>;
} = {}) => ({
  is_video: isVideo,
  ...(displayUrl ? { display_url: displayUrl } : {}),
  ...(displayResources ? { display_resources: displayResources } : {}),
  edge_media_to_caption: {
    edges: [
      {
        node: {
          text: caption,
        },
      },
    ],
  },
  owner: {
    ...(ownerUsername ? { username: ownerUsername } : {}),
  },
  ...(children.length > 0
    ? {
        edge_sidecar_to_children: {
          edges: children.map((node) => ({ node })),
        },
      }
    : {}),
});

const createInstagramMediaNode = ({
  displayUrl,
  displayResources,
  isVideo = false,
}: {
  displayUrl: string;
  displayResources?: Array<{ src: string; config_width: number; config_height: number }>;
  isVideo?: boolean;
}) => ({
  is_video: isVideo,
  display_url: displayUrl,
  ...(displayResources ? { display_resources: displayResources } : {}),
});

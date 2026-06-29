import { describe, expect, it, vi } from "vitest";
import { type RecipeImportError } from "../types";
import {
  createXTwitterCanonicalUrl,
  getXTwitterSource,
  xTwitterSourceExtractionAdapter,
} from "./x-twitter";

const STATUS_ID = "2071084010705727927";
const CANONICAL_URL = `https://x.com/HG7654321/status/${STATUS_ID}`;

describe("X/Twitter source extraction URL handling", () => {
  it.each([
    {
      url: `https://x.com/HG7654321/status/${STATUS_ID}`,
      canonicalUrl: CANONICAL_URL,
      source: {
        statusId: STATUS_ID,
        username: "HG7654321",
        kind: "userStatus",
      },
    },
    {
      url: `https://twitter.com/HG7654321/status/${STATUS_ID}?s=20&t=abc#ignored`,
      canonicalUrl: CANONICAL_URL,
      source: {
        statusId: STATUS_ID,
        username: "HG7654321",
        kind: "userStatus",
      },
    },
    {
      url: `https://mobile.twitter.com/HG7654321/status/${STATUS_ID}/photo/1`,
      canonicalUrl: CANONICAL_URL,
      source: {
        statusId: STATUS_ID,
        username: "HG7654321",
        kind: "userStatus",
      },
    },
    {
      url: `https://x.com/HG7654321/status/${STATUS_ID}/video/1`,
      canonicalUrl: CANONICAL_URL,
      source: {
        statusId: STATUS_ID,
        username: "HG7654321",
        kind: "userStatus",
      },
    },
    {
      url: `https://x.com/i/web/status/${STATUS_ID}`,
      canonicalUrl: `https://x.com/i/web/status/${STATUS_ID}`,
      source: {
        statusId: STATUS_ID,
        kind: "webStatus",
      },
    },
    {
      url: `https://twitter.com/i/web/status/${STATUS_ID}`,
      canonicalUrl: `https://x.com/i/web/status/${STATUS_ID}`,
      source: {
        statusId: STATUS_ID,
        kind: "webStatus",
      },
    },
  ])("$url からX/Twitter sourceを抽出する", ({ url, canonicalUrl, source }) => {
    expect(getXTwitterSource(url)).toEqual({
      canonicalUrl,
      ...source,
    });
    expect(
      xTwitterSourceExtractionAdapter.match({
        normalizedUrl: url,
        host: new URL(url).hostname.replace(/^www\./, ""),
      }),
    ).toBe(true);
  });

  it("canonical URLを生成する", () => {
    expect(
      createXTwitterCanonicalUrl({
        username: "HG7654321",
        statusId: STATUS_ID,
        kind: "userStatus",
      }),
    ).toBe(CANONICAL_URL);
    expect(createXTwitterCanonicalUrl({ statusId: STATUS_ID, kind: "webStatus" })).toBe(
      `https://x.com/i/web/status/${STATUS_ID}`,
    );
  });

  it.each([
    "http://x.com/HG7654321/status/2071084010705727927",
    "https://www.x.com/HG7654321/status/2071084010705727927",
    "https://x.com/HG7654321",
    "https://x.com/search?q=recipe",
    "https://x.com/intent/tweet",
    "https://x.com/i/lists/123",
    "https://x.com/HG7654321/status/not-numeric",
    "https://x.com/HG7654321/status/2071084010705727927/photo/0",
    "https://x.com/HG7654321/status/2071084010705727927/likes",
    "https://x.com:444/HG7654321/status/2071084010705727927",
    "https://user@x.com/HG7654321/status/2071084010705727927",
    "https://x.com/user-name/status/2071084010705727927",
    "not-a-url",
  ])("対象外URLにはmatchしない: %s", (url) => {
    expect(getXTwitterSource(url)).toBeNull();
    expect(
      xTwitterSourceExtractionAdapter.match({
        normalizedUrl: url,
        host: "x.com",
      }),
    ).toBe(false);
  });
});

describe("X/Twitter source extraction adapter", () => {
  it("text-only postからAI inputを作る", async () => {
    const fetchHtml = createFetchHtml(
      createPage(
        CANONICAL_URL,
        createXTwitterHtml({
          description: "材料&#10;卵 2個&#10;作り方&#10;焼く",
        }),
      ),
    );

    const result = await xTwitterSourceExtractionAdapter.extract(createContext({ fetchHtml }));

    expect(fetchHtml).toHaveBeenCalledWith(CANONICAL_URL);
    expect(result).toEqual({
      input: {
        source: {
          finalUrl: CANONICAL_URL,
          host: "x.com",
        },
        markdownContent: "材料\n卵 2個\n作り方\n焼く",
        recipeStructuredEvidence: [],
      },
      imageCandidates: [],
      source: {
        sourceUrl: CANONICAL_URL,
        sourceName: "X",
      },
      warnings: [],
    });
  });

  it("literal newlineを含むmeta descriptionから本文を抽出する", async () => {
    const result = await xTwitterSourceExtractionAdapter.extract(
      createContext({
        fetchHtml: createFetchHtml(
          createPage(
            CANONICAL_URL,
            createXTwitterHtml({
              description: [
                "ツンとしない手作り和風にんにくドレッシングの作り方",
                "おろしにんにく大4",
                "材料全てを鍋で一度沸騰させる",
              ].join("\n"),
            }),
          ),
        ),
      }),
    );

    expect(result.input.markdownContent).toBe(
      [
        "ツンとしない手作り和風にんにくドレッシングの作り方",
        "おろしにんにく大4",
        "材料全てを鍋で一度沸騰させる",
      ].join("\n"),
    );
  });

  it("1画像postではcoverとsourceMediaへ同じ画像を配置する", async () => {
    const imageUrl = "https://pbs.twimg.com/media/HL337ewbEAIg_Ux.jpg?format=jpg&name=large";
    const result = await xTwitterSourceExtractionAdapter.extract(
      createContext({
        fetchHtml: createFetchHtml(
          createPage(
            CANONICAL_URL,
            createXTwitterHtml({
              description: "鶏肉を焼く",
              body: `<script>{"media":"${imageUrl.replaceAll("/", "\\/")}"}</script>`,
            }),
          ),
        ),
      }),
    );

    expect(result.imageCandidates).toEqual([
      {
        id: "x_image_0",
        url: imageUrl,
        alt: "X post image 1",
        position: 0,
      },
    ]);
    expect(result.imagePlacement).toEqual({
      coverImageUrl: imageUrl,
      sourceMediaUrls: [imageUrl],
    });
    expect(result.input.markdownContent).not.toContain(imageUrl);
  });

  it("複数画像postではHTML出現順でsourceMediaへ配置する", async () => {
    const imageUrls = [
      "https://pbs.twimg.com/media/HLzmmXCa0AEoiJK.jpg",
      "https://pbs.twimg.com/media/HLzmmW9bcAAOZMT.jpg",
      "https://pbs.twimg.com/media/HLzmmW7boAA6-yb.jpg",
    ];

    const result = await xTwitterSourceExtractionAdapter.extract(
      createContext({
        fetchHtml: createFetchHtml(
          createPage(
            CANONICAL_URL,
            createXTwitterHtml({
              description: "画像に材料あり",
              body: imageUrls.map((url) => `<span>${url}</span>`).join("\n"),
            }),
          ),
        ),
      }),
    );

    expect(result.imageCandidates.map((candidate) => candidate.url)).toEqual(imageUrls);
    expect(result.imagePlacement).toEqual({
      coverImageUrl: imageUrls[0],
      sourceMediaUrls: imageUrls,
    });
  });

  it(":largeとvariantなしの同一画像は高画質variantだけを配置する", async () => {
    const largeUrl = "https://pbs.twimg.com/media/HL337ewbEAIg_Ux.jpg:large";
    const bareUrl = "https://pbs.twimg.com/media/HL337ewbEAIg_Ux.jpg";
    const secondImageUrl = "https://pbs.twimg.com/media/HLzmmW9bcAAOZMT.jpg";

    const result = await xTwitterSourceExtractionAdapter.extract(
      createContext({
        fetchHtml: createFetchHtml(
          createPage(
            CANONICAL_URL,
            createXTwitterHtml({
              description: "画像に材料あり",
              body: [bareUrl, largeUrl, secondImageUrl].join("\n"),
            }),
          ),
        ),
      }),
    );

    expect(result.imageCandidates.map((candidate) => candidate.url)).toEqual([
      largeUrl,
      secondImageUrl,
    ]);
    expect(result.imagePlacement).toEqual({
      coverImageUrl: largeUrl,
      sourceMediaUrls: [largeUrl, secondImageUrl],
    });
  });

  it("?name違いの同一画像は高画質variantだけを配置する", async () => {
    const smallUrl = "https://pbs.twimg.com/media/HL337ewbEAIg_Ux.jpg?format=jpg&name=small";
    const largeUrl = "https://pbs.twimg.com/media/HL337ewbEAIg_Ux?format=jpg&name=large";

    const result = await xTwitterSourceExtractionAdapter.extract(
      createContext({
        fetchHtml: createFetchHtml(
          createPage(
            CANONICAL_URL,
            createXTwitterHtml({
              description: "画像に材料あり",
              body: [smallUrl, largeUrl].join("\n"),
            }),
          ),
        ),
      }),
    );

    expect(result.imageCandidates.map((candidate) => candidate.url)).toEqual([largeUrl]);
    expect(result.imagePlacement).toEqual({
      coverImageUrl: largeUrl,
      sourceMediaUrls: [largeUrl],
    });
  });

  it.each([
    "amplify_video_thumb",
    "ext_tw_video_thumb",
    "tweet_video_thumb",
  ])("動画postでは%s thumbnailをcoverにしsourceMediaへ配置しない", async (thumbnailPrefix) => {
    const thumbnailUrl = `https://pbs.twimg.com/${thumbnailPrefix}/2070/img/abc.jpg`;
    const videoUrl = "https://video.twimg.com/amplify_video/2070/vid/avc1/720x1280/abc.mp4";

    const result = await xTwitterSourceExtractionAdapter.extract(
      createContext({
        fetchHtml: createFetchHtml(
          createPage(
            CANONICAL_URL,
            createXTwitterHtml({
              description: "動画で作り方を紹介",
              body: `${thumbnailUrl}\n${videoUrl}`,
            }),
          ),
        ),
      }),
    );

    expect(result.imageCandidates).toEqual([
      {
        id: "x_video_thumbnail_0",
        url: thumbnailUrl,
        alt: "X post video thumbnail 1",
        position: 0,
      },
    ]);
    expect(result.imagePlacement).toEqual({
      coverImageUrl: thumbnailUrl,
      sourceMediaUrls: [],
    });
  });

  it("profile/default画像と重複画像を除外する", async () => {
    const imageUrl = "https://pbs.twimg.com/media/HL337ewbEAIg_Ux.jpg";

    const result = await xTwitterSourceExtractionAdapter.extract(
      createContext({
        fetchHtml: createFetchHtml(
          createPage(
            CANONICAL_URL,
            createXTwitterHtml({
              description: "豆腐を煮る",
              body: [
                "https://pbs.twimg.com/profile_images/123/avatar.jpg",
                "https://abs.twimg.com/rweb/ssr/default/profile_400x400.png",
                imageUrl,
                imageUrl,
              ].join("\n"),
            }),
          ),
        ),
      }),
    );

    expect(result.imageCandidates.map((candidate) => candidate.url)).toEqual([imageUrl]);
  });

  it("本文がない場合はextraction_failedにする", async () => {
    await expect(
      xTwitterSourceExtractionAdapter.extract(
        createContext({
          fetchHtml: createFetchHtml(createPage(CANONICAL_URL, "<html><head></head></html>")),
        }),
      ),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("private/login/unavailable HTMLはprivate_or_login_requiredにする", async () => {
    await expect(
      xTwitterSourceExtractionAdapter.extract(
        createContext({
          fetchHtml: createFetchHtml(
            createPage(
              CANONICAL_URL,
              "<html><body>This post is unavailable. Log in to X</body></html>",
            ),
          ),
        }),
      ),
    ).rejects.toMatchObject({
      code: "private_or_login_required",
    } satisfies Partial<RecipeImportError>);
  });

  it("fallback descriptionだけがあるlogin/unavailable HTMLはprivate_or_login_requiredにする", async () => {
    await expect(
      xTwitterSourceExtractionAdapter.extract(
        createContext({
          fetchHtml: createFetchHtml(
            createPage(
              CANONICAL_URL,
              [
                "<html>",
                "<head>",
                '<meta name="twitter:description" content="See what people are saying on X.">',
                "</head>",
                "<body>This post is unavailable. Log in to X</body>",
                "</html>",
              ].join(""),
            ),
          ),
        }),
      ),
    ).rejects.toMatchObject({
      code: "private_or_login_required",
    } satisfies Partial<RecipeImportError>);
  });
});

const createContext = ({
  normalizedUrl = CANONICAL_URL,
  fetchHtml = createFetchHtml(CANONICAL_URL, createXTwitterHtml({ description: "材料" })),
}: {
  normalizedUrl?: string;
  fetchHtml?: ReturnType<typeof createFetchHtml>;
} = {}) => ({
  normalizedUrl,
  host: new URL(normalizedUrl).hostname.replace(/^www\./, ""),
  timeoutMs: 1000,
  fetchHtml,
});

const createPage = (url: string, body: string) => ({
  finalUrl: url,
  contentType: "text/html; charset=utf-8",
  body,
});

const createFetchHtml = (pageOrUrl: ReturnType<typeof createPage> | string, body?: string) => {
  const page = typeof pageOrUrl === "string" ? createPage(pageOrUrl, body ?? "") : pageOrUrl;
  return vi.fn(async () => page);
};

const createXTwitterHtml = ({
  description,
  body = "",
}: {
  description?: string;
  body?: string;
}) => `
  <html>
    <head>
      ${description ? `<meta property="og:description" content="${description}">` : ""}
      <meta property="og:title" content="Recipe post / X">
      <meta name="twitter:description" content="fallback">
    </head>
    <body>${body}</body>
  </html>
`;

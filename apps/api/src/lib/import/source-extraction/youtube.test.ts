import { describe, expect, it } from "vitest";
import { type RecipeImportError } from "../types";
import {
  createYouTubeCanonicalUrl,
  getYouTubeVideoId,
  youtubeSourceExtractionAdapter,
} from "./youtube";

const VIDEO_ID = "FyLCRXMANAM";
const CANONICAL_URL = "https://www.youtube.com/watch?v=FyLCRXMANAM";

describe("YouTube source extraction URL handling", () => {
  it.each([
    "https://www.youtube.com/watch?v=FyLCRXMANAM",
    "https://www.youtube.com/watch?v=FyLCRXMANAM&list=PL123&feature=shared",
    "https://youtu.be/FyLCRXMANAM?si=vxf25wqv_kohdf4L",
    "https://www.youtube.com/shorts/FyLCRXMANAM",
    "https://m.youtube.com/watch?v=FyLCRXMANAM",
  ])("%s からvideoIdを抽出する", (url) => {
    expect(getYouTubeVideoId(url)).toBe(VIDEO_ID);
    expect(youtubeSourceExtractionAdapter.match({ normalizedUrl: url, host: "youtube.com" })).toBe(
      true,
    );
    expect(
      youtubeSourceExtractionAdapter.resolveFetchRequest({
        normalizedUrl: url,
        host: "youtube.com",
      }),
    ).toEqual({
      url: CANONICAL_URL,
    });
  });

  it("対象外URLにはmatchしない", () => {
    expect(getYouTubeVideoId("https://www.youtube.com/playlist?list=PL123")).toBeNull();
    expect(getYouTubeVideoId("https://example.com/watch?v=FyLCRXMANAM")).toBeNull();
    expect(getYouTubeVideoId("https://www.youtube.com/watch?v=too-short")).toBeNull();
  });

  it("canonical URLを生成する", () => {
    expect(createYouTubeCanonicalUrl(VIDEO_ID)).toBe(CANONICAL_URL);
  });
});

describe("YouTube source extraction adapter", () => {
  it("videoDetailsからAI inputと最大サムネイル候補を作る", async () => {
    const result = await youtubeSourceExtractionAdapter.convert({
      normalizedUrl: "https://youtu.be/FyLCRXMANAM?si=vxf25wqv_kohdf4L",
      page: createPage(
        CANONICAL_URL,
        createYouTubeHtml({
          videoId: VIDEO_ID,
          title: "鶏むねキャベツ鍋",
          author: "Recipe Channel",
          shortDescription: "材料\nキャベツ 500g\n鶏むね肉 350g\n作り方\n煮る",
          thumbnail: {
            thumbnails: [
              { url: "https://i.ytimg.com/vi/FyLCRXMANAM/default.jpg", width: 120, height: 90 },
              {
                url: "https://i.ytimg.com/vi/FyLCRXMANAM/maxresdefault.jpg",
                width: 1280,
                height: 720,
              },
            ],
          },
        }),
      ),
    });

    expect(result).toEqual({
      input: {
        source: {
          finalUrl: CANONICAL_URL,
          host: "youtube.com",
        },
        markdownContent: [
          "# 鶏むねキャベツ鍋",
          "",
          "Source: YouTube",
          "Channel: Recipe Channel",
          "",
          "![YouTube thumbnail](<https://i.ytimg.com/vi/FyLCRXMANAM/maxresdefault.jpg>)",
          "",
          "## Description",
          "",
          "材料\nキャベツ 500g\n鶏むね肉 350g\n作り方\n煮る",
        ].join("\n"),
        recipeStructuredEvidence: [],
      },
      imageCandidates: [
        {
          id: "youtube_thumbnail",
          url: "https://i.ytimg.com/vi/FyLCRXMANAM/maxresdefault.jpg",
          alt: "鶏むねキャベツ鍋 thumbnail",
          position: 0,
        },
      ],
      source: {
        sourceUrl: CANONICAL_URL,
        sourceName: "YouTube",
      },
      warnings: [],
    });
  });

  it("説明欄が空でもtitleとthumbnailで成功する", async () => {
    const result = await youtubeSourceExtractionAdapter.convert({
      normalizedUrl: CANONICAL_URL,
      page: createPage(
        CANONICAL_URL,
        createYouTubeHtml({
          videoId: VIDEO_ID,
          title: "説明欄なしShorts",
          author: "Recipe Channel",
          shortDescription: "",
          thumbnail: {
            thumbnails: [
              { url: "https://i.ytimg.com/vi/FyLCRXMANAM/hqdefault.jpg", width: 480, height: 360 },
            ],
          },
        }),
      ),
    });

    expect(result.input.markdownContent).toBe(
      [
        "# 説明欄なしShorts",
        "",
        "Source: YouTube",
        "Channel: Recipe Channel",
        "",
        "![YouTube thumbnail](<https://i.ytimg.com/vi/FyLCRXMANAM/hqdefault.jpg>)",
      ].join("\n"),
    );
    expect(result.input.markdownContent).not.toContain("## Description");
  });

  it("ytInitialPlayerResponse不在はextraction_failedにする", async () => {
    await expect(
      youtubeSourceExtractionAdapter.convert({
        normalizedUrl: CANONICAL_URL,
        page: createPage(CANONICAL_URL, "<html><body>No player response</body></html>"),
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });

  it("videoId不一致はextraction_failedにする", async () => {
    await expect(
      youtubeSourceExtractionAdapter.convert({
        normalizedUrl: CANONICAL_URL,
        page: createPage(
          CANONICAL_URL,
          createYouTubeHtml({
            videoId: "LZ7gPKzDrzY",
            title: "別動画",
            shortDescription: "材料",
          }),
        ),
      }),
    ).rejects.toMatchObject({
      code: "extraction_failed",
    } satisfies Partial<RecipeImportError>);
  });
});

const createPage = (url: string, body: string) => ({
  finalUrl: url,
  contentType: "text/html; charset=utf-8",
  body,
});

const createYouTubeHtml = (videoDetails: unknown) => `
  <html>
    <head>
      <script>
        var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails })};
      </script>
    </head>
    <body></body>
  </html>
`;

import { describe, expect, it, vi } from "vitest";
import { createYouTubeDataClient, type YouTubeDataError } from "./youtube-data";

const VIDEO_ID = "FyLCRXMANAM";

describe("YouTube Data API client", () => {
  it("videos.list responseを動画metadataへ変換する", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        items: [
          {
            id: VIDEO_ID,
            snippet: {
              title: " 鶏むねキャベツ鍋 ",
              description: " 材料\nキャベツ 500g ",
              channelTitle: " Recipe Channel ",
              thumbnails: {
                default: {
                  url: "https://i.ytimg.com/vi/FyLCRXMANAM/default.jpg",
                  width: 120,
                  height: 90,
                },
                maxres: {
                  url: "https://i.ytimg.com/vi/FyLCRXMANAM/maxresdefault.jpg",
                  width: 1280,
                  height: 720,
                },
              },
            },
          },
        ],
      }),
    );

    const client = createYouTubeDataClient({ apiKey: "test-api-key", fetcher });

    await expect(client.getVideo({ videoId: VIDEO_ID, timeoutMs: 1000 })).resolves.toEqual({
      videoId: VIDEO_ID,
      canonicalUrl: "https://www.youtube.com/watch?v=FyLCRXMANAM",
      title: "鶏むねキャベツ鍋",
      description: "材料\nキャベツ 500g",
      channelTitle: "Recipe Channel",
      thumbnails: [
        {
          url: "https://i.ytimg.com/vi/FyLCRXMANAM/default.jpg",
          width: 120,
          height: 90,
        },
        {
          url: "https://i.ytimg.com/vi/FyLCRXMANAM/maxresdefault.jpg",
          width: 1280,
          height: 720,
        },
      ],
    });

    const requestUrl = new URL(fetcher.mock.calls[0]?.[0].toString() ?? "");
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      "https://www.googleapis.com/youtube/v3/videos",
    );
    expect(requestUrl.searchParams.get("part")).toBe("snippet");
    expect(requestUrl.searchParams.get("id")).toBe(VIDEO_ID);
    expect(requestUrl.searchParams.get("key")).toBe("test-api-key");
    expect(requestUrl.searchParams.get("fields")).toBe(
      "items(id,snippet(title,description,channelTitle,thumbnails))",
    );
  });

  it("itemsが空ならnullを返す", async () => {
    const client = createYouTubeDataClient({
      apiKey: "test-api-key",
      fetcher: vi.fn(async () => Response.json({ items: [] })),
    });

    await expect(client.getVideo({ videoId: VIDEO_ID, timeoutMs: 1000 })).resolves.toBeNull();
  });

  it("quota errorを分類する", async () => {
    const client = createYouTubeDataClient({
      apiKey: "test-api-key",
      fetcher: vi.fn(async () =>
        Response.json(
          {
            error: {
              errors: [{ reason: "quotaExceeded" }],
            },
          },
          { status: 403 },
        ),
      ),
    });

    await expect(client.getVideo({ videoId: VIDEO_ID, timeoutMs: 1000 })).rejects.toMatchObject({
      code: "quota_exceeded",
    } satisfies Partial<YouTubeDataError>);
  });

  it("不正なsuccess responseはinvalid_responseにする", async () => {
    const client = createYouTubeDataClient({
      apiKey: "test-api-key",
      fetcher: vi.fn(async () => Response.json({ items: [{ id: VIDEO_ID }] })),
    });

    await expect(client.getVideo({ videoId: VIDEO_ID, timeoutMs: 1000 })).rejects.toMatchObject({
      code: "invalid_response",
    } satisfies Partial<YouTubeDataError>);
  });

  it("timeoutを分類する", async () => {
    const client = createYouTubeDataClient({
      apiKey: "test-api-key",
      fetcher: vi.fn((_url, init) => {
        const signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }),
    });

    await expect(client.getVideo({ videoId: VIDEO_ID, timeoutMs: 1 })).rejects.toMatchObject({
      code: "timeout",
    } satisfies Partial<YouTubeDataError>);
  });
});

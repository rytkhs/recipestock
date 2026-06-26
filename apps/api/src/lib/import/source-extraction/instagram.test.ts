import { describe, expect, it } from "vitest";
import {
  createInstagramCanonicalUrl,
  getInstagramSource,
  instagramSourceExtractionAdapter,
} from "./instagram";

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
    "https://www.instagram.com/p/",
    "https://www.instagram.com/p/DYsxvKyAZMg*/",
    "https://www.instagram.com:444/p/DYsxvKyAZMg/",
    "https://user@www.instagram.com/p/DYsxvKyAZMg/",
    "https://www.instagram.com/p/DYsxvKyAZMg/extra/",
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

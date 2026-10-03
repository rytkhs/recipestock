import { createSourceExtractor } from "./importer";
import { instagramSourceExtractionAdapter } from "./instagram";
import { tiktokSourceExtractionAdapter } from "./tiktok";
import { xTwitterSourceExtractionAdapter } from "./x-twitter";
import { youtubeSourceExtractionAdapter } from "./youtube";

export { createSourceExtractor, type SourceExtractor } from "./importer";

const sourceExtractionAdapters = [
  xTwitterSourceExtractionAdapter,
  instagramSourceExtractionAdapter,
  tiktokSourceExtractionAdapter,
  youtubeSourceExtractionAdapter,
];

export const defaultSourceExtractor = createSourceExtractor(sourceExtractionAdapters);

/**
 * URLから取り込んだときと同じ出典名を、ページを読まずに決める。
 * 対応しているプラットフォームならその名前、ほかはホスト名にする。
 */
export const resolveSourceNameForUrl = (normalizedUrl: string) => {
  const host = new URL(normalizedUrl).hostname.replace(/^www\./, "");
  const adapter = sourceExtractionAdapters.find((candidate) =>
    candidate.match({ normalizedUrl, host }),
  );

  return adapter?.sourceName ?? host;
};

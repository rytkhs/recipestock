import { createSourceExtractor } from "./importer";
import { instagramSourceExtractionAdapter } from "./instagram";
import { tiktokSourceExtractionAdapter } from "./tiktok";
import { xTwitterSourceExtractionAdapter } from "./x-twitter";
import { youtubeSourceExtractionAdapter } from "./youtube";

export { createSourceExtractor, type SourceExtractor } from "./importer";

export const defaultSourceExtractor = createSourceExtractor([
  xTwitterSourceExtractionAdapter,
  instagramSourceExtractionAdapter,
  tiktokSourceExtractionAdapter,
  youtubeSourceExtractionAdapter,
]);

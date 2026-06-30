import { createSourceExtractor } from "./importer";
import { instagramSourceExtractionAdapter } from "./instagram";
import { xTwitterSourceExtractionAdapter } from "./x-twitter";
import { youtubeSourceExtractionAdapter } from "./youtube";

export { createSourceExtractor, type SourceExtractor } from "./importer";

export const defaultSourceExtractor = createSourceExtractor([
  xTwitterSourceExtractionAdapter,
  instagramSourceExtractionAdapter,
  youtubeSourceExtractionAdapter,
]);

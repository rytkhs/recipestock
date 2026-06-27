import { createSourceExtractor } from "./importer";
import { instagramSourceExtractionAdapter } from "./instagram";
import { youtubeSourceExtractionAdapter } from "./youtube";

export { createSourceExtractor, type SourceExtractor } from "./importer";

export const defaultSourceExtractor = createSourceExtractor([
  instagramSourceExtractionAdapter,
  youtubeSourceExtractionAdapter,
]);

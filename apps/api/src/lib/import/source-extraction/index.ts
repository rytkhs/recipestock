import { createSourceExtractor } from "./importer";
import { youtubeSourceExtractionAdapter } from "./youtube";

export { createSourceExtractor, type SourceExtractor } from "./importer";

export const defaultSourceExtractor = createSourceExtractor([youtubeSourceExtractionAdapter]);

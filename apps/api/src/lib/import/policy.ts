import { isHttpFetchUrlAllowed } from "../../url-safety";
import { type FetchedImportPage, RecipeImportError } from "./types";

export const assertImportUrlAllowed = (sourceUrl: string) => {
  if (!isHttpFetchUrlAllowed(sourceUrl)) {
    throw new RecipeImportError("invalid_url", "Import URL is invalid.");
  }
};

export const assertFetchedPageIsHtml = (page: FetchedImportPage) => {
  if (page.contentType && !/html/i.test(page.contentType)) {
    throw new RecipeImportError("unsupported_page", "Import URL is not an HTML page.");
  }
};

import { describe, expect, it } from "vitest";
import { assertFetchedPageIsHtml, assertImportContentTypeMayBeHtml } from "./policy";
import { type FetchedImportPage, type RecipeImportError } from "./types";

describe("import page content policy", () => {
  it.each([
    "text/html",
    "text/html; charset=utf-8",
    "application/xhtml+xml",
  ])("HTML系Content-Type %sを許可する", async (contentType) => {
    await expect(assertFetchedPageIsHtml(createPage(contentType, "not inspected"))).resolves.toBe(
      undefined,
    );
  });

  it.each([
    "",
    "text/plain",
    "application/octet-stream",
  ])("曖昧なContent-Type %sでもHTMLらしい本文を許可する", async (contentType) => {
    await expect(
      assertFetchedPageIsHtml(
        createPage(contentType, `${"x".repeat(128)}<!DOCTYPE html><html></html>`),
      ),
    ).resolves.toBe(undefined);
  });

  it.each([
    "",
    "text/plain",
    "application/octet-stream",
  ])("曖昧なContent-Type %sでHTMLではない本文を拒否する", async (contentType) => {
    await expect(
      assertFetchedPageIsHtml(createPage(contentType, "plain recipe text")),
    ).rejects.toMatchObject({
      code: "unsupported_page",
    } satisfies Partial<RecipeImportError>);
  });

  it("4KBより後ろにだけHTML markerがある本文を拒否する", async () => {
    await expect(
      assertFetchedPageIsHtml(createPage("text/plain", `${"x".repeat(4096)}<html></html>`)),
    ).rejects.toMatchObject({
      code: "unsupported_page",
    } satisfies Partial<RecipeImportError>);
  });

  it.each([
    "application/json",
    "application/pdf",
    "image/png",
  ])("明確な非HTML Content-Type %sを拒否する", async (contentType) => {
    expect(() => assertImportContentTypeMayBeHtml(contentType)).toThrow(
      "Import URL is not an HTML page.",
    );
    await expect(
      assertFetchedPageIsHtml(createPage(contentType, "<html></html>")),
    ).rejects.toMatchObject({
      code: "unsupported_page",
    } satisfies Partial<RecipeImportError>);
  });

  it("Response本文の検査後も元の本文を読み取れる", async () => {
    const body = "<html><body>Tomato pasta</body></html>";
    const response = new Response(body);
    const page = createPage("text/plain", response);

    await expect(assertFetchedPageIsHtml(page)).resolves.toBe(undefined);
    await expect(response.text()).resolves.toBe(body);
  });
});

const createPage = (contentType: string, body: FetchedImportPage["body"]): FetchedImportPage => ({
  finalUrl: "https://example.com/recipe",
  contentType,
  body,
});

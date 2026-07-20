import { describe, expect, it } from "vitest";
import { isAllowedPrecacheUrl, validateAppShellManifest } from "./build-manifest";

const entry = (url: string) => ({ url, revision: "revision", size: 1 });

describe("App Shell precache manifest", () => {
  it("公開Shellとhashed JS/CSSだけを許可する", async () => {
    const manifest = [
      entry("index.html"),
      entry("manifest.webmanifest"),
      entry("icons/icon-192.png"),
      entry("assets/app-a1b2.js"),
      entry("assets/app-a1b2.css"),
    ];

    await expect(validateAppShellManifest(manifest)).resolves.toEqual({
      manifest,
      warnings: [],
    });
  });

  it.each([
    "api/me",
    "icons/icon-512.png",
    "icons/shortcuts/import-url-192.png",
    "screenshots/recipes-wide.png",
    "assets/private.png",
  ])("%sをprecache対象にしない", (url) => {
    expect(isAllowedPrecacheUrl(url)).toBe(false);
  });

  it("必須entryが欠けたbuildを拒否する", async () => {
    await expect(
      validateAppShellManifest([
        entry("index.html"),
        entry("manifest.webmanifest"),
        entry("assets/app-a1b2.js"),
      ]),
    ).rejects.toThrow("missing: icons/icon-192.png");
  });

  it("allowlist外のentryを含むbuildを拒否する", async () => {
    await expect(
      validateAppShellManifest([
        entry("index.html"),
        entry("manifest.webmanifest"),
        entry("icons/icon-192.png"),
        entry("api/me"),
      ]),
    ).rejects.toThrow("disallowed: api/me");
  });
});

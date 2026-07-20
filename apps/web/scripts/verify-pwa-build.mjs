import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const distDirectory = resolve(process.cwd(), "dist");
const serviceWorkerPath = join(distDirectory, "sw.js");

const fail = (message) => {
  throw new Error(`PWA build verification failed: ${message}`);
};

if (!existsSync(serviceWorkerPath)) {
  fail("dist/sw.js does not exist.");
}

const serviceWorkerSource = readFileSync(serviceWorkerPath, "utf8");
if (serviceWorkerSource.includes("__WB_MANIFEST")) {
  fail("the Workbox manifest placeholder remains in dist/sw.js.");
}

const precacheUrls = new Set(
  [...serviceWorkerSource.matchAll(/["']?url["']?\s*:\s*["']([^"']+)["']/g)].map(([, url]) =>
    url.replace(/^\/+/, ""),
  ),
);

const requiredEntries = ["index.html", "manifest.webmanifest", "icons/icon-192.png"];
for (const entry of requiredEntries) {
  if (!precacheUrls.has(entry)) {
    fail(`${entry} is not present in the injected precache manifest.`);
  }
}

const listFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });

const assetsDirectory = join(distDirectory, "assets");
const hashedAssets = existsSync(assetsDirectory)
  ? listFiles(assetsDirectory)
      .filter((path) => statSync(path).isFile() && /\.(?:js|css)$/.test(path))
      .map((path) => relative(distDirectory, path).split(sep).join("/"))
  : [];

for (const asset of hashedAssets) {
  if (!precacheUrls.has(asset)) {
    fail(`${asset} is not present in the injected precache manifest.`);
  }
}

const apiEntry = [...precacheUrls].find((url) => url === "api" || url.startsWith("api/"));
if (apiEntry) {
  fail(`${apiEntry} must not be precached.`);
}

console.log(`Verified ${precacheUrls.size} App Shell precache entries in dist/sw.js.`);

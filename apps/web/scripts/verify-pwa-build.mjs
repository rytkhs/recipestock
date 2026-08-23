import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const distDirectory = resolve(process.cwd(), "dist");
const serviceWorkerPath = join(distDirectory, "sw.js");

const fail = (message) => {
  throw new Error(`PWA build verification failed: ${message}`);
};

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`${relative(distDirectory, path)} is missing or invalid JSON.`);
  }
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

const viteManifestPath = join(distDirectory, ".vite", "manifest.json");
if (!existsSync(viteManifestPath)) {
  fail(".vite/manifest.json does not exist.");
}

const viteManifest = readJson(viteManifestPath);
const entry = Object.values(viteManifest).find(
  (manifestEntry) => manifestEntry.isEntry && manifestEntry.src === "index.html",
);
if (!entry) {
  fail("index.html is not present as the build entry in .vite/manifest.json.");
}

const entryPath = join(distDirectory, entry.file);
if (!existsSync(entryPath)) {
  fail(`${entry.file} from .vite/manifest.json does not exist.`);
}

const lazyRouteSources = [
  "src/routes/login.tsx",
  "src/routes/import.tsx",
  "src/routes/recipes-index.tsx",
  "src/routes/recipe-detail.tsx",
  "src/routes/recipe-editor.tsx",
  "src/routes/settings-index.tsx",
  "src/routes/settings-billing.tsx",
];
const staticSources = new Set();
const visitStaticImports = (manifestEntry) => {
  if (!manifestEntry || staticSources.has(manifestEntry.src)) {
    return;
  }

  staticSources.add(manifestEntry.src);
  for (const importedFile of manifestEntry.imports ?? []) {
    const importedEntry = Object.values(viteManifest).find(
      (candidate) => candidate.file === importedFile,
    );
    visitStaticImports(importedEntry);
  }
};
visitStaticImports(entry);

const eagerlyLoadedRoutes = lazyRouteSources.filter((source) => staticSources.has(source));
if (eagerlyLoadedRoutes.length > 0) {
  fail(
    `lazy route modules are statically imported by the HTML entry: ${eagerlyLoadedRoutes.join(", ")}.`,
  );
}

const dynamicallyLoadedRoutes = new Set(entry.dynamicImports ?? []);
const missingDynamicRoutes = lazyRouteSources.filter(
  (source) => !dynamicallyLoadedRoutes.has(source),
);
if (missingDynamicRoutes.length > 0) {
  fail(
    `lazy route modules are not dynamic imports of the HTML entry: ${missingDynamicRoutes.join(", ")}.`,
  );
}

const entryBytes = readFileSync(entryPath).byteLength;
const entryGzipBytes = gzipSync(readFileSync(entryPath)).byteLength;
console.log(
  `Initial entry ${entry.file}: ${entryBytes} bytes (${entryGzipBytes} bytes gzip); ` +
    `precache: ${precacheUrls.size} entries.`,
);

console.log(`Verified ${precacheUrls.size} App Shell precache entries in dist/sw.js.`);

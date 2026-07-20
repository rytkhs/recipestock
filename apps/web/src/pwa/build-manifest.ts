type PrecacheEntry = {
  revision: string | null;
  size: number;
  url: string;
};

type ManifestTransformResult = {
  manifest: PrecacheEntry[];
  warnings: string[];
};

const requiredStaticEntries = new Set(["index.html", "manifest.webmanifest", "icons/icon-192.png"]);

const normalizeUrl = (url: string) => url.replace(/^\/+/, "");

export const isAllowedPrecacheUrl = (url: string) => {
  const normalizedUrl = normalizeUrl(url);

  return requiredStaticEntries.has(normalizedUrl) || /^assets\/.+\.(?:js|css)$/.test(normalizedUrl);
};

export const validateAppShellManifest = async (
  manifest: PrecacheEntry[],
): Promise<ManifestTransformResult> => {
  const normalizedEntries = manifest.map((entry) => ({
    ...entry,
    url: normalizeUrl(entry.url),
  }));
  const urls = new Set(normalizedEntries.map(({ url }) => url));
  const missingEntries = [...requiredStaticEntries].filter((url) => !urls.has(url));
  const disallowedEntries = normalizedEntries
    .map(({ url }) => url)
    .filter((url) => !isAllowedPrecacheUrl(url));

  if (missingEntries.length > 0 || disallowedEntries.length > 0) {
    const details = [
      missingEntries.length > 0 ? `missing: ${missingEntries.join(", ")}` : null,
      disallowedEntries.length > 0 ? `disallowed: ${disallowedEntries.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("; ");

    throw new Error(`Invalid App Shell precache manifest (${details}).`);
  }

  return { manifest: normalizedEntries, warnings: [] };
};

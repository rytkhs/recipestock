import {
  type FetchedImportPage,
  RecipeImportError,
  type RecipeImportImageCandidate,
} from "../types";
import {
  type SourceExtractionAdapter,
  type SourceExtractionContext,
  type SourceExtractionMatchInput,
} from "./types";

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);
const INSTAGRAM_ROUTES = new Set(["p", "reel", "reels"]);
const INSTAGRAM_SHORTCODE = /^[A-Za-z0-9_-]+$/;
const INSTAGRAM_USERNAME = /^[A-Za-z0-9._]+$/;
const INSTAGRAM_SOURCE_NAME = "Instagram";

type InstagramMediaKind = "post" | "reel";

type InstagramSource = {
  canonicalUrl: string;
  shortcode: string;
  mediaKind: InstagramMediaKind;
};

type InstagramDisplayResource = {
  src?: unknown;
  config_width?: unknown;
  config_height?: unknown;
};

type InstagramMediaNode = {
  is_video?: unknown;
  display_url?: unknown;
  display_resources?: unknown;
};

type InstagramShortcodeMedia = InstagramMediaNode & {
  owner?: {
    username?: unknown;
    full_name?: unknown;
  };
  caption?: {
    text?: unknown;
  };
  edge_media_to_caption?: {
    edges?: Array<{
      node?: {
        text?: unknown;
      };
    }>;
  };
  edge_sidecar_to_children?: {
    edges?: Array<{
      node?: InstagramMediaNode;
    }>;
  };
};

type InstagramEmbedProjection = {
  title: string;
  author: string;
  caption: string;
  imageCandidates: RecipeImportImageCandidate[];
  coverImageUrl?: string;
  sourceMediaUrls: string[];
};

export const instagramSourceExtractionAdapter: SourceExtractionAdapter = {
  id: "instagram",

  match(input: SourceExtractionMatchInput) {
    return getInstagramSource(input.normalizedUrl) !== null;
  },

  async extract(context: SourceExtractionContext) {
    const source = getInstagramSource(context.normalizedUrl);
    if (!source) {
      throw new RecipeImportError("invalid_url", "Instagram URL is invalid.");
    }

    const page = await context.fetchHtml(createInstagramEmbedUrl(source));
    const html = await readFetchedPageText(page);
    const media = extractInstagramShortcodeMedia(html);
    if (!media) {
      if (isPrivateOrLoginRequiredHtml(html)) {
        throw new RecipeImportError(
          "private_or_login_required",
          "Instagram post is private, unavailable, or requires login.",
        );
      }

      throw new RecipeImportError(
        "extraction_failed",
        "Instagram embed metadata could not be extracted.",
      );
    }

    const projection = projectInstagramEmbedMedia(source, media);
    if (!projection.caption) {
      throw new RecipeImportError("extraction_failed", "Instagram caption could not be extracted.");
    }

    return {
      promptProfile: "social",
      input: {
        source: {
          finalUrl: source.canonicalUrl,
          host: "instagram.com",
        },
        markdownContent: buildInstagramMarkdownContent({
          title: projection.title,
          author: projection.author,
          canonicalUrl: source.canonicalUrl,
          caption: projection.caption,
        }),
      },
      imageCandidates: projection.imageCandidates,
      imagePlacement: {
        ...(projection.coverImageUrl ? { coverImageUrl: projection.coverImageUrl } : {}),
        sourceMediaUrls: projection.sourceMediaUrls,
      },
      source: {
        sourceUrl: source.canonicalUrl,
        sourceName: INSTAGRAM_SOURCE_NAME,
      },
      warnings: [],
    };
  },
};

export const getInstagramSource = (rawUrl: string): InstagramSource | null => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (!INSTAGRAM_HOSTS.has(url.hostname)) return null;
  if (url.port || url.username || url.password) return null;

  const pathnameParts = url.pathname.split("/").filter(Boolean);
  if (pathnameParts.length !== 2 && pathnameParts.length !== 3) return null;

  const [route, shortcode] = pathnameParts.length === 2 ? pathnameParts : pathnameParts.slice(1);

  if (pathnameParts.length === 3 && !INSTAGRAM_USERNAME.test(pathnameParts[0])) return null;

  if (!INSTAGRAM_ROUTES.has(route)) return null;
  if (!INSTAGRAM_SHORTCODE.test(shortcode)) return null;

  const source = {
    shortcode,
    mediaKind: route === "p" ? "post" : "reel",
  } satisfies Omit<InstagramSource, "canonicalUrl">;

  return {
    ...source,
    canonicalUrl: createInstagramCanonicalUrl(source),
  };
};

export const createInstagramCanonicalUrl = ({
  shortcode,
  mediaKind,
}: Omit<InstagramSource, "canonicalUrl">) => {
  const route = mediaKind === "reel" ? "reel" : "p";
  return `https://www.instagram.com/${route}/${encodeURIComponent(shortcode)}/`;
};

const createInstagramEmbedUrl = (source: InstagramSource) => `${source.canonicalUrl}embed/`;

const readFetchedPageText = async (page: FetchedImportPage) => {
  if (typeof page.body === "string") return page.body;
  return page.body.text();
};

const extractInstagramShortcodeMedia = (html: string): InstagramShortcodeMedia | null => {
  for (const payload of extractContextJsonPayloads(html)) {
    if (!isRecord(payload)) continue;

    const gqlData = payload.gql_data;
    if (!isRecord(gqlData)) continue;

    const media = gqlData.shortcode_media;
    if (isRecord(media)) return media as InstagramShortcodeMedia;
  }

  return null;
};

const extractContextJsonPayloads = (html: string) => {
  const payloads: unknown[] = [];
  const patterns = [
    /"contextJSON"\s*:\s*"((?:\\.|[^"\\])*)"/g,
    /contextJSON\s*=\s*"([^"]*)"|contextJSON\s*=\s*'([^']*)'/g,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const raw = match[1] ?? match[2];
      if (!raw) continue;

      const decoded = decodeHtml(raw);
      const candidates = [decoded, decodeJsonString(decoded)];
      for (const candidate of candidates) {
        const payload = parseJson(candidate);
        if (payload !== null) payloads.push(payload);
      }
    }
  }

  return payloads;
};

const projectInstagramEmbedMedia = (
  source: InstagramSource,
  media: InstagramShortcodeMedia,
): InstagramEmbedProjection => {
  const author = normalizeString(
    readString(media.owner?.username) ?? readString(media.owner?.full_name),
  );
  const title = author ? `Post by ${author}` : "Instagram post";
  const caption = normalizeString(
    readString(media.edge_media_to_caption?.edges?.[0]?.node?.text) ??
      readString(media.caption?.text),
  );
  const children = getInstagramMediaChildren(media);
  const displayNodes = children.length > 0 ? children : [media];
  const coverImageUrl = selectBestDisplayImage(displayNodes[0]);
  const sourceMediaNodes =
    source.mediaKind === "reel"
      ? []
      : children.length > 0
        ? children.filter((child) => !isInstagramVideoNode(child))
        : isInstagramVideoNode(media)
          ? []
          : [media];
  const sourceMediaUrls = uniqueUrls(sourceMediaNodes.map(selectBestDisplayImage));
  const imageCandidates = buildInstagramImageCandidates(sourceMediaUrls, title);

  return {
    title,
    author,
    caption,
    imageCandidates,
    ...(coverImageUrl ? { coverImageUrl } : {}),
    sourceMediaUrls,
  };
};

const getInstagramMediaChildren = (media: InstagramShortcodeMedia): InstagramMediaNode[] => {
  const edges = media.edge_sidecar_to_children?.edges;
  if (!Array.isArray(edges)) return [];

  return edges
    .map((edge) => edge?.node)
    .filter((node): node is InstagramMediaNode => isRecord(node));
};

const selectBestDisplayImage = (node: InstagramMediaNode | undefined) => {
  if (!node) return undefined;

  const resources = Array.isArray(node.display_resources)
    ? (node.display_resources as InstagramDisplayResource[])
    : [];
  const bestResource = resources
    .filter((resource) => typeof resource.src === "string")
    .sort((a, b) => displayResourceArea(b) - displayResourceArea(a))[0];

  if (typeof bestResource?.src === "string") return bestResource.src;
  return readString(node.display_url);
};

const displayResourceArea = (resource: InstagramDisplayResource) =>
  readNumber(resource.config_width) * readNumber(resource.config_height);

const isInstagramVideoNode = (node: InstagramMediaNode) => node.is_video === true;

const buildInstagramImageCandidates = (urls: string[], title: string) =>
  urls.map((url, position) => ({
    id: `instagram_image_${position}`,
    url,
    alt: `${title} image ${position + 1}`,
    position,
  }));

const uniqueUrls = (urls: Array<string | undefined>) => {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
  }

  return unique;
};

const buildInstagramMarkdownContent = ({
  title,
  author,
  canonicalUrl,
  caption,
}: {
  title: string;
  author: string;
  canonicalUrl: string;
  caption: string;
}) => {
  const lines = [`# ${title}`, "", `Source: ${INSTAGRAM_SOURCE_NAME}`, `URL: ${canonicalUrl}`];
  if (author) lines.push(`Author: ${author}`);
  lines.push("", "## Caption", "", caption);

  return lines.join("\n").trim();
};

const normalizeString = (value: string | null | undefined) => value?.trim() ?? "";

const readString = (value: unknown) => (typeof value === "string" ? value : undefined);

const readNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseJson = (value: string) => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const decodeJsonString = (value: string) => {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replaceAll("\\/", "/");
  }
};

const decodeHtml = (value: string) =>
  value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

const isPrivateOrLoginRequiredHtml = (html: string) =>
  /login|log in|ログイン|challenge|captcha|checkpoint/i.test(html);

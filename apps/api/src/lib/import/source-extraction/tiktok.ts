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

const TIKTOK_HOSTS = new Set(["tiktok.com", "www.tiktok.com", "m.tiktok.com"]);
const TIKTOK_SHORT_HOSTS = new Set(["vt.tiktok.com", "vm.tiktok.com"]);
const TIKTOK_POST_ROUTES = new Set(["video", "photo"]);
const TIKTOK_CONTENT_ID = /^[0-9]{1,32}$/;
const TIKTOK_USERNAME = /^[A-Za-z0-9._]{1,24}$/;
const TIKTOK_SHORT_CODE = /^[A-Za-z0-9]{1,32}$/;
const TIKTOK_STATE_PATTERN =
  /<script[^>]+id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/;
const TIKTOK_ERROR_PAGE_NAME = "video_v2_error";
const TIKTOK_SOURCE_NAME = "TikTok";

type TikTokMediaKind = "video" | "photo";

type TikTokPostTarget = {
  kind: "post";
  contentId: string;
};

export type TikTokUrlTarget =
  | TikTokPostTarget
  | {
      kind: "short";
      shortUrl: string;
    };

type TikTokAuthorInfos = {
  uniqueId?: unknown;
};

type TikTokItemInfos = {
  id?: unknown;
  text?: unknown;
  covers?: unknown;
  coversOrigin?: unknown;
};

type TikTokVideoData = {
  itemInfos?: TikTokItemInfos;
  authorInfos?: TikTokAuthorInfos;
  imagePostInfo?: {
    displayImages?: unknown;
  };
};

type TikTokProjection = {
  canonicalUrl: string;
  title: string;
  author: string;
  caption: string;
  imageCandidates: RecipeImportImageCandidate[];
  coverImageUrl?: string;
  referenceImageUrls: string[];
};

export const tiktokSourceExtractionAdapter: SourceExtractionAdapter = {
  id: "tiktok",

  match(input: SourceExtractionMatchInput) {
    return getTikTokUrlTarget(input.normalizedUrl) !== null;
  },

  async extract(context: SourceExtractionContext) {
    const target = getTikTokUrlTarget(context.normalizedUrl);
    if (!target) {
      throw new RecipeImportError("invalid_url", "TikTok URL is invalid.");
    }

    const post =
      target.kind === "post" ? target : await resolveTikTokShortUrl(context, target.shortUrl);

    const page = await context.fetchHtml(createTikTokEmbedUrl(post.contentId));
    const html = await readFetchedPageText(page);
    const videoData = extractTikTokVideoData(html, post.contentId);
    if (!videoData) {
      throw new RecipeImportError(
        "extraction_failed",
        "TikTok embed metadata could not be extracted.",
      );
    }

    if (normalizeString(readString(videoData.itemInfos?.id)) !== post.contentId) {
      throw new RecipeImportError(
        "extraction_failed",
        "TikTok post identity could not be verified.",
      );
    }

    const projection = projectTikTokVideoData(post.contentId, videoData);
    if (!projection.caption && projection.referenceImageUrls.length === 0) {
      throw new RecipeImportError("extraction_failed", "TikTok caption could not be extracted.");
    }

    return {
      promptProfile: "social",
      input: {
        source: {
          finalUrl: projection.canonicalUrl,
          host: "tiktok.com",
        },
        markdownContent: buildTikTokMarkdownContent(projection),
      },
      imageCandidates: projection.imageCandidates,
      imagePlacement: {
        ...(projection.coverImageUrl ? { coverImageUrl: projection.coverImageUrl } : {}),
        referenceImageUrls: projection.referenceImageUrls,
      },
      source: {
        sourceUrl: projection.canonicalUrl,
        sourceName: TIKTOK_SOURCE_NAME,
      },
      warnings: [],
    };
  },
};

export const getTikTokUrlTarget = (rawUrl: string): TikTokUrlTarget | null => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.port || url.username || url.password) return null;

  const pathnameParts = url.pathname.split("/").filter(Boolean);

  if (TIKTOK_SHORT_HOSTS.has(url.hostname)) {
    if (pathnameParts.length !== 1) return null;
    if (!TIKTOK_SHORT_CODE.test(pathnameParts[0])) return null;

    return { kind: "short", shortUrl: `https://${url.hostname}/${pathnameParts[0]}/` };
  }

  if (!TIKTOK_HOSTS.has(url.hostname)) return null;

  if (pathnameParts.length === 2 && pathnameParts[0] === "t") {
    if (!TIKTOK_SHORT_CODE.test(pathnameParts[1])) return null;

    return { kind: "short", shortUrl: `https://www.tiktok.com/t/${pathnameParts[1]}/` };
  }

  if (pathnameParts.length !== 3) return null;

  const [author, route, contentId] = pathnameParts;
  if (!author.startsWith("@")) return null;
  if (!TIKTOK_USERNAME.test(author.slice(1))) return null;
  if (!TIKTOK_POST_ROUTES.has(route)) return null;
  if (!TIKTOK_CONTENT_ID.test(contentId)) return null;

  return { kind: "post", contentId };
};

export const createTikTokCanonicalUrl = ({
  username,
  mediaKind,
  contentId,
}: {
  username: string;
  mediaKind: TikTokMediaKind;
  contentId: string;
}) =>
  `https://www.tiktok.com/@${encodeURIComponent(username)}/${mediaKind}/${encodeURIComponent(contentId)}`;

const createTikTokEmbedUrl = (contentId: string) =>
  `https://www.tiktok.com/embed/v2/${encodeURIComponent(contentId)}`;

const resolveTikTokShortUrl = async (
  context: SourceExtractionContext,
  shortUrl: string,
): Promise<TikTokPostTarget> => {
  const page = await context.fetchHtml(shortUrl);
  const target = getTikTokUrlTarget(page.finalUrl);
  if (!target || target.kind !== "post") {
    throw new RecipeImportError("extraction_failed", "TikTok short URL could not be resolved.");
  }

  return target;
};

const readFetchedPageText = async (page: FetchedImportPage) => {
  if (typeof page.body === "string") return page.body;
  return page.body.text();
};

const extractTikTokVideoData = (html: string, contentId: string): TikTokVideoData | null => {
  const stateJson = html.match(TIKTOK_STATE_PATTERN)?.[1];
  if (!stateJson) return null;

  const state = parseJson(stateJson);
  if (!isRecord(state)) return null;

  const source = state.source;
  if (!isRecord(source)) return null;

  const data = source.data;
  if (!isRecord(data)) return null;

  const entry = data[`/embed/v2/${contentId}`];
  if (!isRecord(entry)) return null;
  if (entry.isError === true || entry.pageName === TIKTOK_ERROR_PAGE_NAME) return null;

  const videoData = entry.videoData;
  if (!isRecord(videoData)) return null;

  return videoData as TikTokVideoData;
};

const projectTikTokVideoData = (
  contentId: string,
  videoData: TikTokVideoData,
): TikTokProjection => {
  const author = normalizeString(readString(videoData.authorInfos?.uniqueId));
  if (!TIKTOK_USERNAME.test(author)) {
    throw new RecipeImportError("extraction_failed", "TikTok author could not be extracted.");
  }

  const title = `Post by ${author}`;
  const caption = normalizeString(readString(videoData.itemInfos?.text));
  const displayImages = readTikTokDisplayImages(videoData);
  const mediaKind: TikTokMediaKind = displayImages.length > 0 ? "photo" : "video";

  if (mediaKind === "video") {
    const coverImageUrl = selectTikTokCoverImage(videoData.itemInfos);

    return {
      canonicalUrl: createTikTokCanonicalUrl({ username: author, mediaKind, contentId }),
      title,
      author,
      caption,
      imageCandidates: coverImageUrl
        ? [{ id: "tiktok_cover", url: coverImageUrl, alt: `${title} cover`, position: 0 }]
        : [],
      ...(coverImageUrl ? { coverImageUrl } : {}),
      referenceImageUrls: [],
    };
  }

  const displayImageUrls = uniqueImageUrls(displayImages.map(readTikTokDisplayImageUrl));
  if (displayImageUrls.length === 0) {
    throw new RecipeImportError(
      "extraction_failed",
      "TikTok photo carousel images could not be extracted.",
    );
  }

  return {
    canonicalUrl: createTikTokCanonicalUrl({ username: author, mediaKind, contentId }),
    title,
    author,
    caption,
    imageCandidates: displayImageUrls.map((url, position) => ({
      id: `tiktok_image_${position}`,
      url,
      alt: `${title} image ${position + 1}`,
      position,
    })),
    coverImageUrl: displayImageUrls[0],
    referenceImageUrls: displayImageUrls,
  };
};

const readTikTokDisplayImages = (videoData: TikTokVideoData) => {
  const displayImages = videoData.imagePostInfo?.displayImages;
  return Array.isArray(displayImages) ? displayImages : [];
};

const readTikTokDisplayImageUrl = (displayImage: unknown) => {
  if (!isRecord(displayImage)) return undefined;
  if (!Array.isArray(displayImage.urlList)) return undefined;

  return displayImage.urlList.find(isHttpsUrl);
};

const selectTikTokCoverImage = (itemInfos: TikTokItemInfos | undefined) => {
  for (const covers of [itemInfos?.coversOrigin, itemInfos?.covers]) {
    if (!Array.isArray(covers)) continue;

    const cover = covers.find(isHttpsUrl);
    if (cover) return cover;
  }

  return undefined;
};

const uniqueImageUrls = (urls: Array<string | undefined>) => {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
  }

  return unique;
};

const buildTikTokMarkdownContent = ({ title, author, canonicalUrl, caption }: TikTokProjection) => {
  const lines = [`# ${title}`, "", `Source: ${TIKTOK_SOURCE_NAME}`, `URL: ${canonicalUrl}`];
  if (author) lines.push(`Author: ${author}`);
  if (caption) lines.push("", "## Caption", "", caption);

  return lines.join("\n").trim();
};

const normalizeString = (value: string | null | undefined) => value?.trim() ?? "";

const readString = (value: unknown) => (typeof value === "string" ? value : undefined);

const isHttpsUrl = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("https://");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseJson = (value: string) => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

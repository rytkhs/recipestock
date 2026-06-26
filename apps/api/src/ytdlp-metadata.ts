import { getRandom } from "@cloudflare/containers";
import { z } from "zod";
import { type YtDlpMetadataContainer } from "./ytdlp-metadata-container";

const DEFAULT_CONTAINER_INSTANCE_COUNT = 3;
const DEFAULT_CONTAINER_PORT_READY_TIMEOUT_MS = 20_000;
const CONTAINER_REQUEST_TIMEOUT_PADDING_MS = 2_000;

const ytdlpMetadataPlatformSchema = z.literal("instagram");

const ytdlpMetadataSourceSchema = z.strictObject({
  platform: ytdlpMetadataPlatformSchema,
  canonicalUrl: z.string().url(),
  shortcode: z.string().min(1),
  mediaKind: z.enum(["post", "reel"]),
});

const ytdlpMetadataThumbnailSchema = z.strictObject({
  url: z.string().url(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const ytdlpMetadataImageSchema = z.strictObject({
  url: z.string().url(),
  kind: z.literal("thumbnail"),
  source: z.enum(["top_level", "entry"]),
  entryIndex: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

const ytdlpMetadataSuccessResponseSchema = z.strictObject({
  ok: z.literal(true),
  source: ytdlpMetadataSourceSchema,
  metadata: z.strictObject({
    provider: z.literal("yt-dlp"),
    extractor: z.string().nullable(),
    webpageUrl: z.string().url().nullable(),
    title: z.string().nullable(),
    description: z.string().nullable(),
    uploader: z.string().nullable(),
    thumbnail: z.string().url().nullable(),
    thumbnails: z.array(ytdlpMetadataThumbnailSchema),
    duration: z.number().nullable(),
    availability: z.string().nullable(),
  }),
  images: z.array(ytdlpMetadataImageSchema),
});

const ytdlpMetadataFailureResponseSchema = z.strictObject({
  ok: z.literal(false),
  errorCode: z.enum([
    "invalid_request",
    "unsupported_platform",
    "private_or_login_required",
    "timeout",
    "extraction_failed",
  ]),
  message: z.string().min(1),
});

const ytdlpMetadataResponseSchema = z.discriminatedUnion("ok", [
  ytdlpMetadataSuccessResponseSchema,
  ytdlpMetadataFailureResponseSchema,
]);

export type YtDlpMetadataPlatform = z.infer<typeof ytdlpMetadataPlatformSchema>;
export type YtDlpMetadataSource = z.infer<typeof ytdlpMetadataSourceSchema>;
export type YtDlpMetadata = z.infer<typeof ytdlpMetadataSuccessResponseSchema>;
export type YtDlpMetadataErrorCode = z.infer<
  typeof ytdlpMetadataFailureResponseSchema
>["errorCode"];

export type YtDlpMetadataExtractInput = {
  platform: YtDlpMetadataPlatform;
  url: string;
  timeoutMs: number;
};

export type YtDlpMetadataClient = {
  extract(input: YtDlpMetadataExtractInput): Promise<YtDlpMetadata>;
};

export class YtDlpMetadataError extends Error {
  readonly code: YtDlpMetadataErrorCode;

  constructor(code: YtDlpMetadataErrorCode, message: string) {
    super(message);
    this.name = "YtDlpMetadataError";
    this.code = code;
  }
}

type YtDlpMetadataContainerStub = Pick<
  DurableObjectStub<YtDlpMetadataContainer>,
  "fetch" | "startAndWaitForPorts"
>;

type CreateYtDlpMetadataClientOptions = {
  binding: DurableObjectNamespace<YtDlpMetadataContainer>;
  instances?: number;
  selectContainer?: (
    binding: DurableObjectNamespace<YtDlpMetadataContainer>,
    instances: number,
  ) => Promise<YtDlpMetadataContainerStub>;
  portReadyTimeoutMs?: number;
};

export const createYtDlpMetadataClient = ({
  binding,
  instances = DEFAULT_CONTAINER_INSTANCE_COUNT,
  selectContainer = getRandom,
  portReadyTimeoutMs = DEFAULT_CONTAINER_PORT_READY_TIMEOUT_MS,
}: CreateYtDlpMetadataClientOptions): YtDlpMetadataClient => ({
  async extract(input) {
    const container = await selectContainer(binding, instances);

    await container.startAndWaitForPorts({
      ports: [8080],
      cancellationOptions: {
        portReadyTimeoutMS: portReadyTimeoutMs,
      },
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, resolveContainerRequestTimeoutMs(input.timeoutMs));

    try {
      const response = await container.fetch(
        new Request("http://ytdlp-metadata.local/extract", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(input),
          signal: controller.signal,
        }),
      );
      const payload = ytdlpMetadataResponseSchema.safeParse(await readJsonResponse(response));

      if (!payload.success) {
        throw new YtDlpMetadataError("extraction_failed", "yt-dlp metadata response was invalid.");
      }

      if (!payload.data.ok) {
        throw new YtDlpMetadataError(payload.data.errorCode, payload.data.message);
      }

      return payload.data;
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        throw new YtDlpMetadataError("timeout", "yt-dlp metadata request timed out.");
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  },
});

const readJsonResponse = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    throw new YtDlpMetadataError("extraction_failed", "yt-dlp metadata response was invalid.");
  }
};

const resolveContainerRequestTimeoutMs = (timeoutMs: number) =>
  Math.max(1, timeoutMs) + CONTAINER_REQUEST_TIMEOUT_PADDING_MS;

const isAbortError = (error: unknown) => error instanceof Error && error.name === "AbortError";

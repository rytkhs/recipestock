import { createDb } from "@recipestock/db";
import {
  importUrlRequestSchema,
  iosShareShortcutImportJobRequestSchema,
} from "@recipestock/schemas";
import { type Bindings } from "../../env";
import {
  createImportJobId,
  createImportJobRepository,
  getImportJobExpiresBefore,
  type ImportJobRecord,
  type ImportJobRepository,
  resolveImportJobTimeoutMs,
} from "../../import-jobs";
import { normalizeImportableUrl, RecipeImportError } from "../../import-url";

export type SubmitUrlImportJobInput =
  | {
      entryPoint: "web";
      userId: string;
      url: unknown;
    }
  | {
      entryPoint: "ios_shortcut";
      userId: string;
      url: unknown;
      requestId: string;
    };

export type SubmitUrlImportJobResult =
  | {
      status: "accepted";
      kind: "created" | "existing_active_job";
      job: ImportJobRecord;
    }
  | { status: "invalidUrl" }
  | { status: "invalidRequestId" }
  | { status: "recipeLimitExceeded" };

export type UrlImportJobSubmission = {
  submit(input: SubmitUrlImportJobInput): Promise<SubmitUrlImportJobResult>;
};

type UrlImportJobSubmissionDependencies = {
  env: Bindings;
  importJobRepository?: ImportJobRepository;
  importQueue?: Queue<{ jobId: string }>;
  createImportJobId?: () => string;
  getCurrentDate?: () => Date;
};

export const createUrlImportJobSubmission = ({
  env,
  importJobRepository,
  importQueue,
  createImportJobId: createJobId,
  getCurrentDate,
}: UrlImportJobSubmissionDependencies): UrlImportJobSubmission => ({
  async submit(input) {
    const userId = input.userId;
    const url = input.url;
    const request = importUrlRequestSchema.safeParse({ url });

    if (!request.success) {
      return { status: "invalidUrl" };
    }

    const requestId = input.entryPoint === "ios_shortcut" ? input.requestId : null;
    if (requestId !== null) {
      const shortcutRequest = iosShareShortcutImportJobRequestSchema.safeParse({
        url: request.data.url,
        requestId,
      });
      if (!shortcutRequest.success) {
        return shortcutRequest.error.issues.some((issue) => issue.path[0] === "requestId")
          ? { status: "invalidRequestId" }
          : { status: "invalidUrl" };
      }
    }

    const createdVia = input.entryPoint === "ios_shortcut" ? "ios_shortcut" : "web";
    const completionNotificationRequested = input.entryPoint === "ios_shortcut";

    let normalizedUrl: string;

    try {
      normalizedUrl = normalizeImportableUrl(request.data.url);
    } catch (error) {
      if (error instanceof RecipeImportError && error.code === "invalid_url") {
        return { status: "invalidUrl" };
      }

      throw error;
    }

    const now = getCurrentDate?.() ?? new Date();
    const repository =
      importJobRepository ??
      createImportJobRepository(createDb(env.DATABASE_URL), {
        proPriceId: env.STRIPE_PRO_PRICE_ID,
        now,
      });

    await repository.expireActiveJobsForUser({
      userId,
      expiresBefore: getImportJobExpiresBefore(now, resolveImportJobTimeoutMs(env)),
      now,
    });

    const result = await repository.createUrlJob({
      id: createJobId?.() ?? createImportJobId(),
      userId,
      url: request.data.url,
      normalizedUrl,
      createdVia,
      requestId,
      completionNotificationRequested,
      now,
    });

    if (result.status === "limitExceeded") {
      return { status: "recipeLimitExceeded" };
    }

    if (result.status === "replayedRequest") {
      return {
        status: "accepted",
        kind: result.responseKind,
        job: result.job,
      };
    }

    if (result.status === "existingActiveJob") {
      return {
        status: "accepted",
        kind: "existing_active_job",
        job: result.job,
      };
    }

    try {
      await (importQueue ?? env.IMPORT_QUEUE).send(
        { jobId: result.job.id },
        { contentType: "json" },
      );
    } catch (error) {
      await repository.markJobFailed({
        jobId: result.job.id,
        errorCode: "unknown",
        errorMessage: error instanceof Error ? error.message : "Import queue send failed.",
        now: getCurrentDate?.() ?? new Date(),
      });
      throw error;
    }

    return {
      status: "accepted",
      kind: "created",
      job: result.job,
    };
  },
});

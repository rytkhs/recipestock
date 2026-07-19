import { createDb } from "@recipestock/db";
import { importUrlRequestSchema } from "@recipestock/schemas";
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

export type SubmitUrlImportJobInput = {
  userId: string;
  url: unknown;
  notifyOnCompletion: boolean;
};

export type SubmitUrlImportJobResult =
  | {
      status: "accepted";
      kind: "created" | "existing_active_job";
      job: ImportJobRecord;
    }
  | { status: "invalidUrl" }
  | { status: "recipeLimitExceeded" }
  | { status: "temporarilyUnavailable" };

export type UrlImportJobSubmission = {
  submit(input: SubmitUrlImportJobInput): Promise<SubmitUrlImportJobResult>;
};

export type UrlImportJobSubmissionFactory = (env: Bindings) => UrlImportJobSubmission;

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
    const request = importUrlRequestSchema.safeParse({ url: input.url });

    if (!request.success) {
      return { status: "invalidUrl" };
    }

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
      userId: input.userId,
      expiresBefore: getImportJobExpiresBefore(now, resolveImportJobTimeoutMs(env)),
      now,
    });

    const result = await repository.createUrlJob({
      id: createJobId?.() ?? createImportJobId(),
      userId: input.userId,
      url: request.data.url,
      normalizedUrl,
      completionNotificationRequested: input.notifyOnCompletion,
      now,
    });

    if (result.status === "limitExceeded") {
      return { status: "recipeLimitExceeded" };
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
      return { status: "temporarilyUnavailable" };
    }

    return {
      status: "accepted",
      kind: "created",
      job: result.job,
    };
  },
});

import { createDb } from "@recipestock/db";
import { type Plan } from "@recipestock/shared";
import { type Bindings } from "../../env";
import {
  type CreateImportJobResult,
  createImportJobId,
  createImportJobRepository,
  getImportJobExpiresBefore,
  type ImportJobAiUsageLimits,
  type ImportJobRecord,
  type ImportJobRepository,
  resolveImportJobTimeoutMs,
} from "../../import-jobs";
import { getCurrentJstMonth, resolveAiMonthlyLimit } from "../../usage";

export type SubmitImportJobResult =
  | {
      status: "accepted";
      kind: "created" | "existing_active_job";
      job: ImportJobRecord;
    }
  | { status: "recipeLimitExceeded" }
  | { status: "aiUsageLimitExceeded"; plan: Plan }
  | { status: "temporarilyUnavailable" };

export type ImportJobSubmissionDependencies = {
  env: Bindings;
  importJobRepository?: ImportJobRepository;
  importQueue?: Queue<{ jobId: string }>;
  createImportJobId?: () => string;
  getCurrentDate?: () => Date;
};

type CreateJob = (
  repository: ImportJobRepository,
  params: { id: string; aiUsage: ImportJobAiUsageLimits; now: Date },
) => Promise<CreateImportJobResult>;

/**
 * 検証を終えた入力からImport Jobを作り、Queueへ送る。期限切れJobの処理、上限の判定、active Jobの
 * 再利用、Queueへ送れなかったJobの後始末は、入力の種類や認証方式ごとに実装しない(ADR 0006)。
 */
export const submitImportJob = async (
  {
    env,
    importJobRepository,
    importQueue,
    createImportJobId: createJobId,
    getCurrentDate,
  }: ImportJobSubmissionDependencies,
  { userId, createJob }: { userId: string; createJob: CreateJob },
): Promise<SubmitImportJobResult> => {
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

  const result = await createJob(repository, {
    id: createJobId?.() ?? createImportJobId(),
    aiUsage: {
      month: getCurrentJstMonth(now),
      freeLimit: resolveAiMonthlyLimit("free", env),
      proLimit: resolveAiMonthlyLimit("pro", env),
    },
    now,
  });

  if (result.status === "recipeLimitExceeded") {
    return { status: "recipeLimitExceeded" };
  }

  if (result.status === "aiUsageLimitExceeded") {
    return { status: "aiUsageLimitExceeded", plan: result.plan };
  }

  if (result.status === "existingActiveJob") {
    return {
      status: "accepted",
      kind: "existing_active_job",
      job: result.job,
    };
  }

  try {
    await (importQueue ?? env.IMPORT_QUEUE).send({ jobId: result.job.id }, { contentType: "json" });
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
};

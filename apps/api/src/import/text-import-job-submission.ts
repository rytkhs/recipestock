import { importTextRequestSchema } from "@recipestock/schemas";
import { type Bindings } from "../env";
import {
  type ImportJobSubmissionDependencies,
  type SubmitImportJobResult,
  submitImportJob,
} from "./job-submission";

export type SubmitTextImportJobInput = {
  userId: string;
  text: unknown;
  sourceUrl: unknown;
};

export type SubmitTextImportJobResult =
  | SubmitImportJobResult
  | { status: "invalidText"; issues: unknown };

export type TextImportJobSubmission = {
  submit(input: SubmitTextImportJobInput): Promise<SubmitTextImportJobResult>;
};

export type TextImportJobSubmissionFactory = (env: Bindings) => TextImportJobSubmission;

export const createTextImportJobSubmission = (
  dependencies: ImportJobSubmissionDependencies,
): TextImportJobSubmission => ({
  async submit(input) {
    const request = importTextRequestSchema.safeParse({
      text: input.text,
      sourceUrl: input.sourceUrl,
    });

    if (!request.success) {
      return { status: "invalidText", issues: request.error.flatten() };
    }

    const sourceText = request.data.text;
    const sourceTextDigest = await digestSourceText(sourceText);

    return submitImportJob(dependencies, {
      userId: input.userId,
      createJob: (repository, { id, aiUsage, now }) =>
        repository.createTextJob({
          id,
          userId: input.userId,
          sourceText,
          sourceTextDigest,
          sourceUrl: request.data.sourceUrl ?? null,
          aiUsage,
          now,
        }),
    });
  },
});

/**
 * 連打や再送で同じ原文のImport Jobが並ばないよう、active Jobの同一性を原文のhashで判定する。
 */
const digestSourceText = async (sourceText: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sourceText));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

import { importUrlRequestSchema } from "@recipestock/schemas";
import { type Bindings } from "../../env";
import { normalizeImportableUrl, RecipeImportError } from "../../import-url";
import {
  type ImportJobSubmissionDependencies,
  type SubmitImportJobResult,
  submitImportJob,
} from "./import-job-submission";

export type SubmitUrlImportJobInput = {
  userId: string;
  url: unknown;
  notifyOnCompletion: boolean;
};

export type SubmitUrlImportJobResult = SubmitImportJobResult | { status: "invalidUrl" };

export type UrlImportJobSubmission = {
  submit(input: SubmitUrlImportJobInput): Promise<SubmitUrlImportJobResult>;
};

export type UrlImportJobSubmissionFactory = (env: Bindings) => UrlImportJobSubmission;

export const createUrlImportJobSubmission = (
  dependencies: ImportJobSubmissionDependencies,
): UrlImportJobSubmission => ({
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

    return submitImportJob(dependencies, {
      userId: input.userId,
      createJob: (repository, { id, aiUsage, now }) =>
        repository.createUrlJob({
          id,
          userId: input.userId,
          url: request.data.url,
          normalizedUrl,
          completionNotificationRequested: input.notifyOnCompletion,
          aiUsage,
          now,
        }),
    });
  },
});

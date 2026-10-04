import { RecipeImportError } from "./types";

export const assertImportJobDeadline = (deadline: Date | undefined, now: Date) => {
  if (deadline && now.getTime() >= deadline.getTime()) {
    throw new RecipeImportError("job_timeout", "Import job timed out.");
  }
};

export const resolveBoundedTimeoutMs = (
  timeoutMs: number,
  deadline: Date | undefined,
  now: Date,
) => {
  if (!deadline) return timeoutMs;

  const remainingMs = deadline.getTime() - now.getTime();
  if (remainingMs <= 0) {
    throw new RecipeImportError("job_timeout", "Import job timed out.");
  }

  return Math.min(timeoutMs, remainingMs);
};

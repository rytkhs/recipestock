import { describe, expect, it } from "vitest";
import { importJobSummarySchema } from "./import";

describe("import schemas", () => {
  it("private/login required import error codeを受け入れる", () => {
    expect(
      importJobSummarySchema.parse({
        id: "job_private",
        kind: "url",
        status: "failed",
        url: "https://www.instagram.com/p/DYsxvKyAZMg/",
        recipeId: null,
        errorCode: "private_or_login_required",
        createdAt: "2026-06-01T00:00:00.000Z",
        startedAt: "2026-06-01T00:00:01.000Z",
        finishedAt: "2026-06-01T00:00:10.000Z",
      }),
    ).toMatchObject({
      errorCode: "private_or_login_required",
    });
  });
});

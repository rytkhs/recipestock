import { describe, expect, it } from "vitest";
import { apiErrorResponseSchema } from "./api-error";

describe("API error schemas", () => {
  it("rate limit超過エラーを受け入れる", () => {
    expect(
      apiErrorResponseSchema.parse({
        error: {
          code: "rate_limit_exceeded",
          message: "Too many requests.",
        },
      }),
    ).toEqual({
      error: {
        code: "rate_limit_exceeded",
        message: "Too many requests.",
      },
    });
  });
});

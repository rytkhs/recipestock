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

  it("一時利用不可エラーを受け入れる", () => {
    expect(
      apiErrorResponseSchema.parse({
        error: {
          code: "temporarily_unavailable",
          message: "Service is temporarily unavailable.",
        },
      }),
    ).toEqual({
      error: {
        code: "temporarily_unavailable",
        message: "Service is temporarily unavailable.",
      },
    });
  });
});

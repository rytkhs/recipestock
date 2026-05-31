import { describe, expect, it } from "vitest";
import { aiUsageLimitExceededResponse } from "./api-error";

describe("API errors", () => {
  it("AI月次利用上限到達を429で返す", async () => {
    const response = aiUsageLimitExceededResponse();

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ai_usage_limit_exceeded",
        message: "AI usage limit exceeded.",
      },
    });
  });
});

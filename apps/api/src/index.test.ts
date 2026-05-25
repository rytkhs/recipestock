import { describe, expect, it } from "vitest";
import app from "./index";

describe("api", () => {
  it("responds to health checks", async () => {
    const response = await app.request("/api/health", undefined, {
      APP_ENV: "development",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      environment: "development",
    });
  });
});

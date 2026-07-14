import { describe, expect, it } from "vitest";
import {
  createIosShareImportJobResponseSchema,
  iosShareShortcutImportJobRequestSchema,
} from "./ios-share";

describe("iOS Shortcut import schemas", () => {
  it("HTTP URLとUUID requestIdを受け付ける", () => {
    expect(
      iosShareShortcutImportJobRequestSchema.parse({
        url: "https://example.com/recipe",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    ).toEqual({
      url: "https://example.com/recipe",
      requestId: "550e8400-e29b-41d4-a716-446655440000",
    });
  });

  it("HTTP以外のURLとUUIDでないrequestIdを拒否する", () => {
    expect(
      iosShareShortcutImportJobRequestSchema.safeParse({
        url: "ftp://example.com/recipe",
        requestId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("Import Job受付responseを検証する", () => {
    expect(
      createIosShareImportJobResponseSchema.safeParse({
        kind: "created",
        job: {
          id: "job_1",
          kind: "url",
          createdVia: "ios_shortcut",
          status: "queued",
          url: "https://example.com/recipe",
          recipeId: null,
          errorCode: null,
          errorMessage: null,
          createdAt: "2026-07-11T00:00:00.000Z",
          startedAt: null,
          finishedAt: null,
        },
      }).success,
    ).toBe(true);
  });
});

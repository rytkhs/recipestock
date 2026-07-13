import { describe, expect, it } from "vitest";
import {
  createIosShareImportJobResponseSchema,
  iosShareShortcutImportJobRequestSchema,
} from "./ios-share";

describe("iOS Shortcut import job schemas", () => {
  it("HTTP/HTTPS URLとUUID形式のrequestIdを受け入れる", () => {
    expect(
      iosShareShortcutImportJobRequestSchema.parse({
        url: "https://example.com/recipes/tomato",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    ).toEqual({
      url: "https://example.com/recipes/tomato",
      requestId: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(
      iosShareShortcutImportJobRequestSchema.safeParse({
        url: "http://example.com/recipes/tomato",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      }).success,
    ).toBe(true);
  });

  it("HTTP/HTTPS以外のURLとUUID以外のrequestIdを拒否する", () => {
    expect(
      iosShareShortcutImportJobRequestSchema.safeParse({
        url: "ftp://example.com/recipes/tomato",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      }).success,
    ).toBe(false);
    expect(
      iosShareShortcutImportJobRequestSchema.safeParse({
        url: "https://example.com/recipes/tomato",
        requestId: "request_123",
      }).success,
    ).toBe(false);
  });

  it("受付結果はkindと作成経路を含むImport Job summaryを受け入れる", () => {
    expect(
      createIosShareImportJobResponseSchema.parse({
        kind: "created",
        job: {
          id: "job_123",
          kind: "url",
          createdVia: "ios_shortcut",
          status: "queued",
          url: "https://example.com/recipes/tomato",
          recipeId: null,
          errorCode: null,
          createdAt: "2026-07-14T00:00:00.000Z",
          startedAt: null,
          finishedAt: null,
        },
      }),
    ).toMatchObject({ kind: "created", job: { createdVia: "ios_shortcut" } });
  });
});

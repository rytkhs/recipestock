import { describe, expect, it } from "vitest";
import {
  createIosShareImportJobResponseSchema,
  iosShareShortcutImportJobRequestSchema,
} from "./ios-share";

describe("iOS Shortcut import schemas", () => {
  it("HTTP URLだけを受け付け、未知のfieldを除去する", () => {
    expect(
      iosShareShortcutImportJobRequestSchema.parse({
        url: "https://example.com/recipe",
        requestId: "pre-release-client-value",
      }),
    ).toEqual({
      url: "https://example.com/recipe",
    });
  });

  it("URLの欠落、HTTP以外、4096文字超過を拒否する", () => {
    expect(iosShareShortcutImportJobRequestSchema.safeParse({}).success).toBe(false);
    expect(
      iosShareShortcutImportJobRequestSchema.safeParse({
        url: "ftp://example.com/recipe",
      }).success,
    ).toBe(false);
    expect(
      iosShareShortcutImportJobRequestSchema.safeParse({
        url: `https://example.com/${"a".repeat(4097)}`,
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

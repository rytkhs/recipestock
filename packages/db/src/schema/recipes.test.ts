import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { importJobs, shortcutImportRequests } from "./recipes";

describe("importJobs schema", () => {
  it("同一ユーザー・同一URLのactive jobだけを重複排除する", () => {
    const config = getTableConfig(importJobs);
    const index = config.indexes.find(
      (candidate) => candidate.config.name === "import_jobs_user_normalized_url_active_idx",
    );

    expect(index?.config.unique).toBe(true);
    expect(index?.config.columns).toHaveLength(2);
    expect(config.indexes.map((candidate) => candidate.config.name)).not.toContain(
      "import_jobs_user_active_idx",
    );
  });

  it("作成経路と完了通知の状態を保持する", () => {
    expect(importJobs.createdVia.enumValues).toEqual(["web", "ios_shortcut"]);
    expect(importJobs.createdVia.notNull).toBe(true);
    expect(importJobs.createdVia.default).toBe("web");
    expect(importJobs.completionNotificationRequested.notNull).toBe(true);
    expect(importJobs.completionNotificationRequested.default).toBe(false);
    expect(importJobs.completionNotificationSentAt.notNull).toBe(false);
  });

  it("Shortcut requestの冪等性、rate limit、Job参照用indexを持つ", () => {
    expect(getTableName(shortcutImportRequests)).toBe("shortcut_import_requests");

    const config = getTableConfig(shortcutImportRequests);
    expect(
      config.indexes.find(
        (index) => index.config.name === "shortcut_import_requests_user_request_id_uidx",
      )?.config.unique,
    ).toBe(true);
    expect(config.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "shortcut_import_requests_user_id_created_at_idx",
        "shortcut_import_requests_import_job_id_idx",
      ]),
    );
  });
});

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { importJobs } from "./recipes";

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
});

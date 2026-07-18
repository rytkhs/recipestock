import { neonConfig } from "@neondatabase/serverless";
import { appUsers, createDb, importJobs } from "@recipestock/db";
import { PLAN_LIMITS } from "@recipestock/shared";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createImportJobRepository, type ImportJobRepository } from "../../src/import-jobs";

vi.mock("@cloudflare/containers", () => ({
  Container: class {},
  getRandom: vi.fn(),
}));

const now = new Date("2026-07-14T00:00:00.000Z");

describe("Import Job repository with Neon Postgres", () => {
  let repository: ImportJobRepository;
  let db: ReturnType<typeof createDb>;

  beforeAll(() => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests.");
    }

    const connectionUrl = new URL(databaseUrl);
    neonConfig.fetchEndpoint = `http://${connectionUrl.hostname}:${connectionUrl.port}/sql`;
    neonConfig.poolQueryViaFetch = true;
    neonConfig.useSecureWebSocket = false;
    db = createDb(databaseUrl);
    repository = createImportJobRepository(db);
  });

  const createShortcutJob = (params: { id: string; userId: string; normalizedUrl?: string }) =>
    repository.createUrlJob({
      id: params.id,
      userId: params.userId,
      url: params.normalizedUrl ?? "https://example.com/recipe",
      normalizedUrl: params.normalizedUrl ?? "https://example.com/recipe",
      completionNotificationRequested: true,
      now,
    });

  it("同一URLの同時送信は一つのactive Jobへ収束する", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_url_race_user_${runId}`;

    const results = await Promise.all(
      Array.from({ length: 2 }, (_, index) =>
        createShortcutJob({
          id: `dbtest_url_race_job_${index}_${runId}`,
          userId,
        }),
      ),
    );

    expect(results.filter((result) => result.status === "created")).toHaveLength(1);
    expect(results.filter((result) => result.status === "existingActiveJob")).toHaveLength(1);
    const jobs = results.flatMap((result) => ("job" in result ? [result.job] : []));
    expect(new Set(jobs.map((job) => job.id)).size).toBe(1);

    const storedJobs = await db.select().from(importJobs).where(eq(importJobs.userId, userId));
    expect(storedJobs).toHaveLength(1);
    expect(storedJobs[0]?.id).toBe(jobs[0]?.id);
  });

  it("通知なしのJobを通知ありで再利用すると通知要求だけを有効にする", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_notification_user_${runId}`;
    const normalizedUrl = "https://example.com/notification";

    const webResult = await repository.createUrlJob({
      id: `dbtest_notification_web_${runId}`,
      userId,
      url: normalizedUrl,
      normalizedUrl,
      completionNotificationRequested: false,
      now,
    });
    expect(webResult.status).toBe("created");

    const shortcutResult = await createShortcutJob({
      id: `dbtest_notification_shortcut_${runId}`,
      userId,
      normalizedUrl,
    });

    expect(shortcutResult.status).toBe("existingActiveJob");
    expect(shortcutResult).toMatchObject({
      job: {
        id: `dbtest_notification_web_${runId}`,
        completionNotificationRequested: true,
      },
    });
  });

  it("Recipe上限時はImport Jobを残さない", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_limit_user_${runId}`;
    await db.insert(appUsers).values({
      userId,
      savedRecipeCount: PLAN_LIMITS.free.savedRecipes,
    });

    await expect(
      createShortcutJob({
        id: `dbtest_limit_job_${runId}`,
        userId,
      }),
    ).resolves.toEqual({ status: "limitExceeded" });

    const jobs = await db.select().from(importJobs).where(eq(importJobs.userId, userId));
    expect(jobs).toHaveLength(0);
  });
});

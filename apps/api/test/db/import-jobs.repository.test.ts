import { neonConfig } from "@neondatabase/serverless";
import { appUsers, createDb, importJobs, shortcutImportRequests } from "@recipestock/db";
import { PLAN_LIMITS } from "@recipestock/shared";
import { and, eq } from "drizzle-orm";
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

  const createShortcutJob = (params: {
    id: string;
    userId: string;
    requestId: string;
    normalizedUrl?: string;
  }) =>
    repository.createUrlJob({
      id: params.id,
      userId: params.userId,
      url: params.normalizedUrl ?? "https://example.com/recipe",
      normalizedUrl: params.normalizedUrl ?? "https://example.com/recipe",
      createdVia: "ios_shortcut",
      requestId: params.requestId,
      completionNotificationRequested: true,
      now,
    });

  it("同じrequestIdの同時送信は同じJobに対応付け、createdを一件だけ返す", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_request_user_${runId}`;
    const requestId = crypto.randomUUID();

    const results = await Promise.all([
      createShortcutJob({ id: `dbtest_request_job_a_${runId}`, userId, requestId }),
      createShortcutJob({ id: `dbtest_request_job_b_${runId}`, userId, requestId }),
    ]);

    expect(results.filter((result) => result.status === "created")).toHaveLength(1);
    expect(results.filter((result) => result.status === "replayedRequest")).toHaveLength(1);
    const jobs = results.flatMap((result) => ("job" in result ? [result.job] : []));
    expect(new Set(jobs.map((job) => job.id)).size).toBe(1);

    const requests = await db
      .select()
      .from(shortcutImportRequests)
      .where(
        and(
          eq(shortcutImportRequests.userId, userId),
          eq(shortcutImportRequests.requestId, requestId),
        ),
      );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      importJobId: jobs[0]?.id,
      responseKind: "created",
    });
  });

  it("異なるrequestIdの同一URL同時送信は一つのactive Jobへ収束する", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_url_race_user_${runId}`;
    const requestIds = [crypto.randomUUID(), crypto.randomUUID()];

    const results = await Promise.all(
      requestIds.map((requestId, index) =>
        createShortcutJob({
          id: `dbtest_url_race_job_${index}_${runId}`,
          userId,
          requestId,
        }),
      ),
    );

    expect(results.filter((result) => result.status === "created")).toHaveLength(1);
    expect(results.filter((result) => result.status === "existingActiveJob")).toHaveLength(1);
    const jobs = results.flatMap((result) => ("job" in result ? [result.job] : []));
    expect(new Set(jobs.map((job) => job.id)).size).toBe(1);

    const requests = await db
      .select()
      .from(shortcutImportRequests)
      .where(eq(shortcutImportRequests.userId, userId));
    expect(requests).toHaveLength(2);
    expect(new Set(requests.map((request) => request.importJobId))).toEqual(new Set([jobs[0]?.id]));
    expect(requests.map((request) => request.responseKind).sort()).toEqual([
      "created",
      "existing_active_job",
    ]);
  });

  it("同じrequestIdを異なるURLで同時に使っても孤立Jobを残さない", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_request_url_mismatch_user_${runId}`;
    const requestId = crypto.randomUUID();

    const results = await Promise.all([
      createShortcutJob({
        id: `dbtest_request_url_mismatch_job_a_${runId}`,
        userId,
        requestId,
        normalizedUrl: "https://example.com/recipe-a",
      }),
      createShortcutJob({
        id: `dbtest_request_url_mismatch_job_b_${runId}`,
        userId,
        requestId,
        normalizedUrl: "https://example.com/recipe-b",
      }),
    ]);

    expect(results.filter((result) => result.status === "created")).toHaveLength(1);
    expect(results.filter((result) => result.status === "replayedRequest")).toHaveLength(1);
    const jobs = await db.select().from(importJobs).where(eq(importJobs.userId, userId));
    const returnedJobs = results.flatMap((result) => ("job" in result ? [result.job] : []));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe(returnedJobs[0]?.id);
  });

  it("Web作成JobをShortcutが再利用すると作成経路を変えず通知要求だけを有効にする", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_notification_user_${runId}`;
    const normalizedUrl = "https://example.com/notification";

    const webResult = await repository.createUrlJob({
      id: `dbtest_notification_web_${runId}`,
      userId,
      url: normalizedUrl,
      normalizedUrl,
      createdVia: "web",
      requestId: null,
      completionNotificationRequested: false,
      now,
    });
    expect(webResult.status).toBe("created");

    const shortcutResult = await createShortcutJob({
      id: `dbtest_notification_shortcut_${runId}`,
      userId,
      requestId: crypto.randomUUID(),
      normalizedUrl,
    });

    expect(shortcutResult.status).toBe("existingActiveJob");
    expect(shortcutResult).toMatchObject({
      job: {
        id: `dbtest_notification_web_${runId}`,
        createdVia: "web",
        completionNotificationRequested: true,
      },
    });
  });

  it("Recipe上限時は不完全なShortcut request対応を残さない", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_limit_user_${runId}`;
    const requestId = crypto.randomUUID();
    await db.insert(appUsers).values({
      userId,
      savedRecipeCount: PLAN_LIMITS.free.savedRecipes,
    });

    await expect(
      createShortcutJob({
        id: `dbtest_limit_job_${runId}`,
        userId,
        requestId,
      }),
    ).resolves.toEqual({ status: "limitExceeded" });

    const requests = await db
      .select()
      .from(shortcutImportRequests)
      .where(eq(shortcutImportRequests.userId, userId));
    expect(requests).toHaveLength(0);
  });
});

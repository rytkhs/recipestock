import { afterEach, describe, expect, it, vi } from "vitest";
import { type ImportJobRepository } from "./import-jobs";
import { createApp, handleImportQueueMessageError } from "./index";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API app composition", () => {
  it("Auth APIは認証middlewareを通さずBetter Authへ委譲する", async () => {
    let getSessionCalls = 0;
    const testApp = createApp({
      auth: {
        getSession: async () => {
          getSessionCalls += 1;
          return null;
        },
        handleAuthRequest: async () =>
          Response.json(
            {
              ok: true,
            },
            { status: 202 },
          ),
      },
    });

    const response = await testApp.request(
      "/api/auth/sign-out",
      {
        method: "POST",
      },
      {
        APP_ENV: "development",
      },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(getSessionCalls).toBe(0);
  });
});

describe("import queue handler", () => {
  const createRepository = (events: string[] = []): ImportJobRepository =>
    ({
      markJobFailed: async ({ errorCode, errorMessage }) => {
        events.push(`failed:${errorCode}:${errorMessage}`);
      },
    }) as ImportJobRepository;

  const createMessage = (attempts: number) => {
    const events: string[] = [];

    return {
      events,
      message: {
        id: "message_123",
        attempts,
        body: { jobId: "job_123" },
        ack: () => {
          events.push("ack");
        },
        retry: ({ delaySeconds }: { delaySeconds: number }) => {
          events.push(`retry:${delaySeconds}`);
        },
      },
    };
  };

  it("最終リトライ未満の予期しない例外はmessage.retryする", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { events, message } = createMessage(3);
    const repositoryEvents: string[] = [];

    await handleImportQueueMessageError({
      error: new Error("database failed"),
      importJobRepository: createRepository(repositoryEvents),
      message,
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(events).toEqual(["retry:240"]);
    expect(repositoryEvents).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("最終リトライの予期しない例外はjobをfailedにしてackする", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { events, message } = createMessage(4);
    const repositoryEvents: string[] = [];

    await handleImportQueueMessageError({
      error: new Error("database failed"),
      importJobRepository: createRepository(repositoryEvents),
      message,
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(repositoryEvents).toEqual(["failed:unknown:database failed"]);
    expect(events).toEqual(["ack"]);
  });
});

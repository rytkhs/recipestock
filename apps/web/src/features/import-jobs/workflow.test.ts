import { type ImportJobSummary } from "@recipestock/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasActiveImportJob, retryImportUrlJob } from "./workflow";

const createJob = (overrides: Partial<ImportJobSummary> = {}): ImportJobSummary => ({
  id: "job_123",
  kind: "url",
  status: "failed",
  url: "https://example.com/recipes/tomato",
  recipeId: null,
  errorCode: "fetch_failed",
  createdAt: "2026-06-01T00:00:00.000Z",
  startedAt: "2026-06-01T00:00:01.000Z",
  finishedAt: "2026-06-01T00:00:10.000Z",
  ...overrides,
});

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });

const getRequestPath = (input: RequestInfo | URL) => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return `${input.pathname}${input.search}`;
  return input.url;
};

describe("hasActiveImportJob", () => {
  it("queuedとrunningがあればtrueを返す", () => {
    expect(hasActiveImportJob([createJob({ status: "queued" })])).toBe(true);
    expect(hasActiveImportJob([createJob({ status: "running" })])).toBe(true);
  });

  it("succeededとfailedだけならfalseを返す", () => {
    expect(
      hasActiveImportJob([
        createJob({ status: "succeeded", recipeId: "recipe_123", errorCode: null }),
        createJob({ status: "failed" }),
      ]),
    ).toBe(false);
  });
});

describe("retryImportUrlJob", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finished jobをdismissして同じURLでimport jobを作成する", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (
        getRequestPath(input) === "/api/import/jobs/job_123/dismiss" &&
        init?.method === "PATCH"
      ) {
        return jsonResponse({ job: createJob() });
      }

      if (getRequestPath(input) === "/api/import/url/jobs" && init?.method === "POST") {
        return jsonResponse(
          {
            kind: "created",
            job: createJob({
              id: "job_retry",
              status: "queued",
              errorCode: null,
              startedAt: null,
              finishedAt: null,
            }),
          },
          { status: 202 },
        );
      }

      return new Response(null, { status: 404 });
    });

    await expect(retryImportUrlJob(createJob())).resolves.toMatchObject({
      kind: "created",
      job: {
        id: "job_retry",
      },
    });
    expect(fetchMock.mock.calls.map(([input]) => getRequestPath(input))).toEqual([
      "/api/import/jobs/job_123/dismiss",
      "/api/import/url/jobs",
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/recipes/tomato" }),
      }),
    );
  });

  it("URLがないjobはerrorにする", async () => {
    await expect(retryImportUrlJob(createJob({ url: null }))).rejects.toThrow(
      "Import job URL is missing.",
    );
  });
});

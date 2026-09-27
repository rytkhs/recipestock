import { type RecentImportJob } from "@recipestock/schemas";
import { FREE_RECIPE_LIMIT } from "@recipestock/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findFetchCall,
  getRequestPath,
  jsonResponse,
  mockFetch,
  renderApp,
  viewerResponse,
} from "../test/router-test-utils";

const recentJob = (overrides: Partial<RecentImportJob> = {}): RecentImportJob => ({
  id: "job_123",
  kind: "url",
  status: "running",
  url: "https://example.com/recipes/tomato",
  textPreview: null,
  recipeId: null,
  errorCode: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  startedAt: "2026-06-01T00:00:01.000Z",
  finishedAt: null,
  recipe: null,
  ...overrides,
});

const failedJob = (overrides: Partial<RecentImportJob> = {}) =>
  recentJob({
    id: "job_failed",
    status: "failed",
    errorCode: "fetch_failed",
    finishedAt: "2026-06-01T00:00:10.000Z",
    ...overrides,
  });

const toSummary = ({ recipe: _recipe, ...job }: RecentImportJob) => job;

const mockRecentJobs = (
  jobs: () => RecentImportJob[],
  {
    handler,
    viewer,
  }: {
    handler?: (input: RequestInfo | URL, init?: RequestInit) => Response | undefined;
    viewer?: typeof viewerResponse;
  } = {},
) =>
  mockFetch(
    async (input, init) => {
      const path = getRequestPath(input);

      if (path === "/api/recipes?limit=20") {
        return jsonResponse({ items: [], nextCursor: null });
      }

      if (path === "/api/import/jobs/recent") {
        return jsonResponse({ jobs: jobs() });
      }

      return handler?.(input, init) ?? new Response(null, { status: 404 });
    },
    { authenticated: true, viewer },
  );

const findIsland = () => screen.findByTestId("import-island");

const openPanel = async () => {
  const island = await findIsland();
  await userEvent.click(within(island).getAllByRole("button")[0] as HTMLElement);
  return screen.findByRole("dialog");
};

describe("取り込みのアイランド", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("取り込み中のjobは取り込み元と一緒に出し、複数あれば一つにまとめて開くと一件ずつ見せる", async () => {
    mockRecentJobs(() => [
      recentJob({ id: "job_running", url: "https://www.youtube.com/watch?v=abc" }),
      recentJob({
        id: "job_queued",
        status: "queued",
        url: "https://example.com/recipes/queued",
        startedAt: null,
      }),
    ]);

    await renderApp("/recipes");

    const island = await findIsland();
    expect(island).toHaveTextContent("2件を取り込み中");
    expect(island).toHaveTextContent("youtube.com・example.com");

    const panel = await openPanel();
    expect(within(panel).getByText("youtube.com")).toBeInTheDocument();
    expect(within(panel).getByText("取り込み中")).toBeInTheDocument();
    expect(within(panel).getByText("example.com")).toBeInTheDocument();
    expect(within(panel).getByText("取り込み待ち")).toBeInTheDocument();
  });

  it("保存できたjobはレシピ名を出し、そのレシピを開ける", async () => {
    mockRecentJobs(() => [
      recentJob({
        status: "succeeded",
        recipeId: "recipe_123",
        finishedAt: "2026-06-01T00:00:10.000Z",
        recipe: { title: "トマトパスタ", coverImageUrl: null },
      }),
    ]);

    await renderApp("/recipes");

    const island = await findIsland();
    expect(island).toHaveTextContent("保存しました");
    expect(island).toHaveTextContent("トマトパスタ");
    expect(within(island).getByRole("link", { name: "開く" })).toHaveAttribute(
      "href",
      "/recipes/recipe_123",
    );
  });

  it("保存できたことは5秒見せてから閉じ、続いている取り込みの表示に戻る", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let dismissed = false;
    const fetchMock = mockRecentJobs(
      () => [
        recentJob({ id: "job_running", createdAt: new Date().toISOString() }),
        ...(dismissed
          ? []
          : [
              recentJob({
                id: "job_done",
                status: "succeeded",
                recipeId: "recipe_done",
                finishedAt: "2026-06-01T00:00:10.000Z",
                recipe: { title: "トマトパスタ", coverImageUrl: null },
              }),
            ]),
      ],
      {
        handler: (input, init) => {
          if (
            getRequestPath(input) === "/api/import/jobs/job_done/dismiss" &&
            init?.method === "PATCH"
          ) {
            dismissed = true;
            return jsonResponse({ job: toSummary(recentJob({ id: "job_done" })) });
          }

          return undefined;
        },
      },
    );

    await renderApp("/recipes");

    await expect(findIsland()).resolves.toHaveTextContent("トマトパスタ");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4900);
    });
    expect(findFetchCall(fetchMock, "/api/import/jobs/job_done/dismiss")).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(findFetchCall(fetchMock, "/api/import/jobs/job_done/dismiss")).toEqual([
      "/api/import/jobs/job_done/dismiss",
      expect.objectContaining({ method: "PATCH" }),
    ]);
    await waitFor(() => {
      expect(screen.getByTestId("import-island")).toHaveTextContent("取り込み中");
    });
  });

  it("一覧を開いている間は、保存できたことを閉じない", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = mockRecentJobs(() => [
      recentJob({
        id: "job_done",
        status: "succeeded",
        recipeId: "recipe_done",
        recipe: { title: "トマトパスタ", coverImageUrl: null },
      }),
    ]);

    await renderApp("/recipes");
    await openPanel();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(findFetchCall(fetchMock, "/api/import/jobs/job_done/dismiss")).toBeUndefined();
  });

  it("取り込めなかったjobは時間がたっても閉じない", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = mockRecentJobs(() => [failedJob()]);

    await renderApp("/recipes");

    await expect(findIsland()).resolves.toHaveTextContent("取り込めませんでした");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(findFetchCall(fetchMock, "/api/import/jobs/job_failed/dismiss")).toBeUndefined();
    expect(screen.getByTestId("import-island")).toHaveTextContent("ページを取得できませんでした。");
  });

  it("取得に失敗したURLは、同じURLで再試行して古いjobを閉じる", async () => {
    const fetchMock = mockRecentJobs(() => [failedJob()], {
      handler: (input, init) => {
        const path = getRequestPath(input);

        if (path === "/api/import/jobs/job_failed/dismiss" && init?.method === "PATCH") {
          return jsonResponse({ job: toSummary(failedJob()) });
        }

        if (path === "/api/import/url/jobs" && init?.method === "POST") {
          return jsonResponse(
            { kind: "created", job: toSummary(recentJob({ id: "job_retry", status: "queued" })) },
            { status: 202 },
          );
        }

        return undefined;
      },
    });

    await renderApp("/recipes");

    const panel = await openPanel();
    await userEvent.click(within(panel).getByRole("button", { name: "再試行" }));

    await waitFor(() => {
      expect(findFetchCall(fetchMock, "/api/import/url/jobs")).toEqual([
        "/api/import/url/jobs",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ url: "https://example.com/recipes/tomato" }),
        }),
      ]);
    });
    expect(findFetchCall(fetchMock, "/api/import/jobs/job_failed/dismiss")).toEqual([
      "/api/import/jobs/job_failed/dismiss",
      expect.objectContaining({ method: "PATCH" }),
    ]);
  });

  it("中身を読めなかったURLは、本文を貼って取り込む画面へ案内する", async () => {
    mockRecentJobs(() => [
      failedJob({
        url: "https://www.instagram.com/p/abc/",
        errorCode: "private_or_login_required",
      }),
    ]);

    await renderApp("/recipes");

    const panel = await openPanel();

    expect(within(panel).getByRole("link", { name: "テキストを貼って取り込む" })).toHaveAttribute(
      "href",
      "/import/text?fromJob=job_failed",
    );
    expect(within(panel).queryByRole("button", { name: "再試行" })).not.toBeInTheDocument();
  });

  it("テキストの取り込みは原文の最初の行を出し、失敗したら原文を直す画面から再試行する", async () => {
    mockRecentJobs(() => [
      recentJob({
        id: "job_running",
        kind: "text",
        url: null,
        textPreview: "豚の生姜焼き",
      }),
      failedJob({
        kind: "text",
        url: null,
        textPreview: "今日の夕飯",
        errorCode: "extraction_failed",
      }),
    ]);

    await renderApp("/recipes");

    const panel = await openPanel();

    expect(within(panel).getByText("豚の生姜焼き")).toBeInTheDocument();
    expect(
      within(panel).getByText("テキストからレシピを読み取れませんでした。"),
    ).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "再試行" })).toHaveAttribute(
      "href",
      "/import/text?fromJob=job_failed",
    );
  });

  const renderLimitFailedJob = async (recipeCount: number) => {
    mockRecentJobs(() => [failedJob({ errorCode: "recipe_limit_exceeded" })], {
      viewer: { ...viewerResponse, recipeCount },
    });

    await renderApp("/recipes");

    const panel = await openPanel();
    expect(within(panel).getByText("保存できるレシピ数の上限に達しています。")).toBeInTheDocument();
    return panel;
  };

  it("保存の上限で止まった取り込みには、今も上限にいれば再試行の代わりにプランのページへの入口を出す", async () => {
    const panel = await renderLimitFailedJob(FREE_RECIPE_LIMIT);

    await waitFor(() => {
      expect(within(panel).getByRole("link", { name: "プランを見る" })).toHaveAttribute(
        "href",
        "/settings/billing",
      );
    });
    expect(within(panel).queryByRole("button", { name: "再試行" })).not.toBeInTheDocument();
  });

  it("保存の上限で止まった取り込みでも、あとで枠が空いていれば再試行を出す", async () => {
    const panel = await renderLimitFailedJob(FREE_RECIPE_LIMIT - 1);

    expect(within(panel).getByRole("button", { name: "再試行" })).toBeInTheDocument();
    expect(within(panel).queryByRole("link", { name: "プランを見る" })).not.toBeInTheDocument();
  });

  it("取り込み中のjobを取り消すとアイランドから消える", async () => {
    let canceled = false;
    const fetchMock = mockRecentJobs(() => (canceled ? [] : [recentJob()]), {
      handler: (input, init) => {
        if (
          getRequestPath(input) === "/api/import/jobs/job_123/cancel" &&
          init?.method === "PATCH"
        ) {
          canceled = true;
          return jsonResponse({ job: toSummary(recentJob({ status: "canceled" })) });
        }

        return undefined;
      },
    });

    await renderApp("/recipes");

    const panel = await openPanel();
    await userEvent.click(
      within(panel).getByRole("button", { name: "example.comの取り込みを取り消す" }),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("import-island")).not.toBeInTheDocument();
    });
    expect(findFetchCall(fetchMock, "/api/import/jobs/job_123/cancel")).toEqual([
      "/api/import/jobs/job_123/cancel",
      expect.objectContaining({ method: "PATCH" }),
    ]);
  });

  it("取り消す前に保存できていたら、保存できたことを出す", async () => {
    let finished = false;
    const savedJob = recentJob({
      status: "succeeded",
      recipeId: "recipe_123",
      recipe: { title: "トマトパスタ", coverImageUrl: null },
    });
    mockRecentJobs(() => [finished ? savedJob : recentJob()], {
      handler: (input, init) => {
        if (
          getRequestPath(input) === "/api/import/jobs/job_123/cancel" &&
          init?.method === "PATCH"
        ) {
          finished = true;
          return jsonResponse({ job: toSummary(savedJob) });
        }

        return undefined;
      },
    });

    await renderApp("/recipes");

    const panel = await openPanel();
    await userEvent.click(
      within(panel).getByRole("button", { name: "example.comの取り込みを取り消す" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("import-island")).toHaveTextContent("トマトパスタ");
    });
  });

  it("入力の画面では出さず、ほかの画面では出す", async () => {
    mockRecentJobs(() => [recentJob()], {
      handler: (input) =>
        getRequestPath(input) === "/api/tags" ? jsonResponse({ tags: [] }) : undefined,
    });

    await renderApp("/import/url");

    await expect(screen.findByLabelText("URL")).resolves.toBeInTheDocument();
    await waitFor(() => {
      expect(findFetchCall(vi.mocked(globalThis.fetch), "/api/import/jobs/recent")).toBeDefined();
    });
    expect(screen.queryByTestId("import-island")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "戻る" }));

    await expect(findIsland()).resolves.toHaveTextContent("取り込み中");
  });
});

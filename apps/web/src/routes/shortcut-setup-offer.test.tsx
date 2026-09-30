import { type ShortcutCredential } from "@recipestock/schemas";
import { focusManager, type QueryClient } from "@tanstack/react-query";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shortcutCredentialsQueryKey } from "../features/ios-share/api";
import { recipeListFixture, shortcutCredentialFixture } from "../mocks/fixtures";
import {
  androidUserAgent,
  getRequestPath,
  iPadUserAgent,
  iPhoneUserAgent,
  jsonResponse,
  mockFetch,
  renderApp,
  stubUserAgent,
} from "../test/router-test-utils";

const unusedCredential = shortcutCredentialFixture({ firstUsedAt: null, lastUsedAt: null });

const respondWithRecipes = (recipeCount: number) => (input: RequestInfo | URL) =>
  getRequestPath(input) === "/api/recipes?limit=20"
    ? jsonResponse({ items: recipeListFixture({ count: recipeCount }), nextCursor: null })
    : new Response(null, { status: 404 });

const mockRecipesFetch = ({
  credentials = [],
  recipeCount = 0,
}: {
  credentials?: ShortcutCredential[];
  recipeCount?: number;
} = {}) =>
  mockFetch(respondWithRecipes(recipeCount), {
    authenticated: true,
    shortcutCredentials: credentials,
  });

// 連携の状態を読み、読んだ結果を画面へ届けてから確かめる。読んだ結果はsetTimeout(0)でまとめて画面へ届く。
const waitForCredentialsRead = async (
  queryClient: QueryClient,
  status: "success" | "error" = "success",
) => {
  await vi.waitFor(() => {
    expect(queryClient.getQueryState(shortcutCredentialsQueryKey)?.status).toBe(status);
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};

// ほかのアプリから戻ってきたことにする。
const returnToApp = () => {
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
};

const [firstRecipe] = recipeListFixture({ count: 1 });

// 広い画面のメニューを開く。狭い画面のシートを開くボタンも同じ名前なので、開くものの種類で見分ける。
const openAddRecipeMenu = async () => {
  const buttons = await screen.findAllByRole("button", { name: "レシピ追加" });
  const menuButton = buttons.find((button) => button.getAttribute("aria-haspopup") === "menu");
  if (!menuButton) throw new Error("レシピ追加のメニューが見つかりません");
  await userEvent.click(menuButton);
};

describe("共有の設定への入口", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    focusManager.setFocused(undefined);
    localStorage.clear();
  });

  it("まだ連携していないiPhoneでは、連携の状態を読めてから、空の一覧にURLを貼るのと並べて共有から送る始め方を出す", async () => {
    stubUserAgent(iPhoneUserAgent);
    let releaseCredentials = () => {};
    const heldCredentials = new Promise<void>((resolve) => {
      releaseCredentials = resolve;
    });
    mockFetch(
      async (input) => {
        if (getRequestPath(input) === "/api/shortcut-credentials") {
          await heldCredentials;
          // 発行しただけで共有が届いていないキーは、連携したことにしない。
          return jsonResponse({ credentials: [unusedCredential] });
        }
        return respondWithRecipes(0)(input);
      },
      { authenticated: true },
    );

    await renderApp("/recipes");

    // 読めるまではどちらの始め方も出さない。URLだけの始め方を出してから2択へ差し替えない。
    await expect(screen.findByText("レシピはまだありません")).resolves.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "URLから取り込む" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /共有ボタンから送る/ })).not.toBeInTheDocument();

    releaseCredentials();

    await expect(
      screen.findByRole("link", { name: /共有ボタンから送る/ }),
    ).resolves.toHaveAttribute("href", "/settings/share");
    expect(screen.getByRole("link", { name: /URLを貼って取り込む/ })).toHaveAttribute(
      "href",
      "/import/url",
    );
  });

  it("連携済みのiPhoneと、iPhone・iPad以外では、空の一覧はURLから取り込むだけを出す", async () => {
    stubUserAgent(iPhoneUserAgent);
    mockRecipesFetch({ credentials: [shortcutCredentialFixture()] });

    await renderApp("/recipes");

    await expect(
      screen.findByRole("link", { name: "URLから取り込む" }),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /共有ボタンから送る/ })).not.toBeInTheDocument();

    cleanup();
    vi.restoreAllMocks();
    stubUserAgent(androidUserAgent);
    mockRecipesFetch();

    await renderApp("/recipes");

    await expect(
      screen.findByRole("link", { name: "URLから取り込む" }),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /共有ボタンから送る/ })).not.toBeInTheDocument();
  });

  it("レシピがある一覧で共有の設定を勧め、今はしないを選んだら開き直しても出さない", async () => {
    stubUserAgent(iPhoneUserAgent);
    mockRecipesFetch({ recipeCount: 1 });

    await renderApp("/recipes");

    const nudge = await screen.findByRole("region", { name: "共有ボタンからの取り込み" });
    expect(within(nudge).getByRole("link", { name: "設定する（1分）" })).toHaveAttribute(
      "href",
      "/settings/share",
    );
    await userEvent.click(within(nudge).getByRole("button", { name: "今はしない" }));
    expect(
      screen.queryByRole("region", { name: "共有ボタンからの取り込み" }),
    ).not.toBeInTheDocument();

    cleanup();
    mockRecipesFetch({ recipeCount: 1 });
    const { queryClient } = await renderApp("/recipes");

    await screen.findByRole("heading", { name: firstRecipe?.title });
    await waitForCredentialsRead(queryClient);
    expect(
      screen.queryByRole("region", { name: "共有ボタンからの取り込み" }),
    ).not.toBeInTheDocument();
  });

  it("誘っている間はアプリへ戻るたびに連携の状態を読み直し、連携できたら誘いを消す", async () => {
    stubUserAgent(iPhoneUserAgent);
    mockRecipesFetch({ recipeCount: 1 });

    await renderApp("/recipes");
    await screen.findByRole("region", { name: "共有ボタンからの取り込み" });

    // 一覧を開いたまま、ほかのアプリから共有して連携できた。
    mockRecipesFetch({ credentials: [shortcutCredentialFixture()], recipeCount: 1 });
    returnToApp();

    await vi.waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "共有ボタンからの取り込み" }),
      ).not.toBeInTheDocument();
    });
  });

  it("連携の状態を一度読めたら、読み直しに失敗しても空の一覧の2択を変えない", async () => {
    stubUserAgent(iPhoneUserAgent);
    mockRecipesFetch();

    const { queryClient } = await renderApp("/recipes");
    await screen.findByRole("link", { name: /共有ボタンから送る/ });

    mockFetch(
      (input) =>
        getRequestPath(input) === "/api/shortcut-credentials"
          ? new Response(null, { status: 500 })
          : respondWithRecipes(0)(input),
      { authenticated: true },
    );
    await act(() => queryClient.refetchQueries({ queryKey: shortcutCredentialsQueryKey }));
    await waitForCredentialsRead(queryClient, "error");

    expect(screen.getByRole("link", { name: /共有ボタンから送る/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "URLから取り込む" })).not.toBeInTheDocument();
  });

  it("レシピ追加のシートには、まだ連携していないiPhoneにだけ共有の設定を出す", async () => {
    stubUserAgent(iPhoneUserAgent);
    mockRecipesFetch();

    await renderApp("/recipes");
    await userEvent.click(await screen.findByTestId("add-recipe-fab"));
    const sheet = await screen.findByRole("dialog", { name: "レシピを追加" });

    await expect(
      within(sheet).findByRole("link", { name: /共有から取り込む/ }),
    ).resolves.toHaveAttribute("href", "/settings/share");

    cleanup();
    vi.restoreAllMocks();
    stubUserAgent(iPhoneUserAgent);
    mockRecipesFetch({ credentials: [shortcutCredentialFixture()] });

    const { queryClient } = await renderApp("/recipes");
    await waitForCredentialsRead(queryClient);
    await userEvent.click(await screen.findByTestId("add-recipe-fab"));
    const linkedSheet = await screen.findByRole("dialog", { name: "レシピを追加" });

    await within(linkedSheet).findByRole("link", { name: /^URLから/ });
    expect(
      within(linkedSheet).queryByRole("link", { name: /共有から取り込む/ }),
    ).not.toBeInTheDocument();
  });

  it("レシピ追加のメニューには、まだ連携していないiPadにだけ共有の設定を出し、選ぶと設定を開く", async () => {
    stubUserAgent(iPadUserAgent);
    mockRecipesFetch();

    const { appRouter } = await renderApp("/recipes");
    await openAddRecipeMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: /共有から取り込む/ }));

    await vi.waitFor(() => {
      expect(appRouter.state.location.pathname).toBe("/settings/share");
    });

    cleanup();
    vi.restoreAllMocks();
    stubUserAgent(iPadUserAgent);
    mockRecipesFetch({ credentials: [shortcutCredentialFixture()] });

    const { queryClient } = await renderApp("/recipes");
    await waitForCredentialsRead(queryClient);
    await openAddRecipeMenu();

    await screen.findByRole("menuitem", { name: /^URLから/ });
    expect(screen.queryByRole("menuitem", { name: /共有から取り込む/ })).not.toBeInTheDocument();
  });
});

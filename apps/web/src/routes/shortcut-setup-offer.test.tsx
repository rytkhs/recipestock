import { type ShortcutCredential } from "@recipestock/schemas";
import { type QueryClient } from "@tanstack/react-query";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shortcutCredentialsQueryKey } from "../features/ios-share/api";
import { recipeListFixture, shortcutCredentialFixture } from "../mocks/fixtures";
import {
  getRequestPath,
  iPhoneUserAgent,
  jsonResponse,
  mockFetch,
  renderApp,
  stubUserAgent,
} from "../test/router-test-utils";

const unusedCredential = shortcutCredentialFixture({ firstUsedAt: null, lastUsedAt: null });
const iPadUserAgent =
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** `holdCredentials`を渡すと、それが解決するまで連携キーの一覧を返さない。 */
const mockRecipesFetch = ({
  credentials = [],
  holdCredentials,
  recipeCount = 0,
}: {
  credentials?: ShortcutCredential[];
  holdCredentials?: Promise<void>;
  recipeCount?: number;
} = {}) =>
  mockFetch(
    async (input) => {
      const path = getRequestPath(input);

      if (path === "/api/recipes?limit=20") {
        return jsonResponse({ items: recipeListFixture({ count: recipeCount }), nextCursor: null });
      }
      if (path === "/api/shortcut-credentials") {
        await holdCredentials;
        return jsonResponse({ credentials });
      }

      return new Response(null, { status: 404 });
    },
    { authenticated: true },
  );

// 誘いを出さないことは、連携の状態を読み、読んだ結果を画面へ届けてから確かめる。
// 読んだ結果はsetTimeout(0)でまとめて画面へ届く。
const waitForCredentialsRead = async (queryClient: QueryClient) => {
  await vi.waitFor(() => {
    expect(queryClient.getQueryState(shortcutCredentialsQueryKey)?.status).toBe("success");
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
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
    localStorage.clear();
  });

  it("まだ連携していないiPhoneでは、連携の状態を読めてから、空の一覧にURLを貼るのと並べて共有から送る始め方を出す", async () => {
    stubUserAgent(iPhoneUserAgent);
    let releaseCredentials = () => {};
    // 発行しただけで共有が届いていないキーは、連携したことにしない。
    mockRecipesFetch({
      credentials: [unusedCredential],
      holdCredentials: new Promise<void>((resolve) => {
        releaseCredentials = resolve;
      }),
    });

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

  it("連携済みのiPhoneとiPhone以外では、空の一覧はURLから取り込むだけを出す", async () => {
    stubUserAgent(iPhoneUserAgent);
    mockRecipesFetch({ credentials: [shortcutCredentialFixture()] });

    await renderApp("/recipes");

    await expect(
      screen.findByRole("link", { name: "URLから取り込む" }),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /共有ボタンから送る/ })).not.toBeInTheDocument();

    cleanup();
    vi.restoreAllMocks();
    mockRecipesFetch();

    await renderApp("/recipes");

    await expect(
      screen.findByRole("link", { name: "URLから取り込む" }),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /共有ボタンから送る/ })).not.toBeInTheDocument();
  });

  it("レシピがある一覧で共有の設定を勧め、今はしないを選んだらこの端末では出さない", async () => {
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

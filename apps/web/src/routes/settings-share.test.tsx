import { type ShortcutCredential } from "@recipestock/schemas";
import { focusManager } from "@tanstack/react-query";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shortcutCredentialsQueryKey } from "../features/ios-share/api";
import { shortcutCredentialFixture } from "../mocks/fixtures";
import {
  androidUserAgent,
  getRequestPath,
  iPhoneUserAgent,
  jsonResponse,
  mockFetch,
  renderApp,
} from "../test/router-test-utils";

const shortcutUrl = "https://www.icloud.com/shortcuts/recipe-stock-test";
const issuedToken = `rssc_${"a".repeat(25)}`;
const unusedCredential = (overrides: Partial<ShortcutCredential>) =>
  shortcutCredentialFixture({
    createdAt: new Date().toISOString(),
    firstUsedAt: null,
    lastUsedAt: null,
    ...overrides,
  });
const issuedCredential = unusedCredential({ id: "credential_new", tokenSuffix: "a1B2" });
const usedCredential = (credential: ShortcutCredential) => {
  const usedAt = new Date().toISOString();
  return { ...credential, firstUsedAt: usedAt, lastUsedAt: usedAt };
};
// iPadのSafariは既定でMacと同じUser-Agentを名乗る。
const iPadDesktopUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const replaceShortcutGuide = /同じ名前のショートカットがあると聞かれたら、置き換えてください。/;

class ClipboardItemStub {
  constructor(readonly data: Record<string, Promise<Blob>>) {}
}

const readBlobText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

/**
 * 端末とクリップボードを差し替える。書き込みを頼まれた文字列は`requested`に、書けたものは`copied`に残る。
 * `holdWrite`を渡すと、それが解決するまで書き込みを終えない。
 */
const installDevice = ({
  canWriteClipboard = true,
  holdWrite,
  maxTouchPoints = 5,
  userAgent = iPhoneUserAgent,
}: {
  canWriteClipboard?: boolean;
  holdWrite?: Promise<void>;
  maxTouchPoints?: number;
  userAgent?: string;
} = {}) => {
  const requested: string[] = [];
  const copied: string[] = [];
  const write = vi.fn(async (items: ClipboardItemStub[]) => {
    const text = await readBlobText(await items[0].data["text/plain"]);
    requested.push(text);
    await holdWrite;
    if (!canWriteClipboard) {
      throw new DOMException("Write permission denied.", "NotAllowedError");
    }
    copied.push(text);
  });

  vi.stubGlobal("ClipboardItem", ClipboardItemStub);
  vi.stubGlobal("navigator", { ...navigator, userAgent, maxTouchPoints, clipboard: { write } });

  return { copied, requested, write };
};

/**
 * 連携キーの一覧と発行、解除を受け持つ。`setCredentials`で、ショートカットから共有が届いたことにできる。
 * 発行は`issued`を順に返す。`holdIssue`を渡すと、それが解決するまで発行の応答を返さない。
 */
const mockShortcutFetch = ({
  credentials: initialCredentials = [],
  canIssue = true,
  holdIssue,
  issued = [issuedCredential],
}: {
  credentials?: ShortcutCredential[];
  canIssue?: boolean;
  holdIssue?: Promise<void>;
  issued?: ShortcutCredential[];
} = {}) => {
  let credentials = initialCredentials;
  let canList = true;
  let issueCount = 0;
  const fetchMock = mockFetch(
    async (input, init) => {
      const path = getRequestPath(input);

      if (path === "/api/shortcut-credentials" && init?.method === "GET") {
        return canList
          ? jsonResponse({ credentials })
          : jsonResponse(
              { error: { code: "unknown", message: "Unexpected error occurred." } },
              { status: 500 },
            );
      }
      if (path.startsWith("/api/shortcut-credentials/") && init?.method === "DELETE") {
        const credentialId = path.slice("/api/shortcut-credentials/".length);
        credentials = credentials.filter(({ id }) => id !== credentialId);
        return jsonResponse({ revoked: true });
      }
      if (path === "/api/shortcut-credentials" && init?.method === "POST") {
        await holdIssue;
        const credential = issued[issueCount];
        if (!canIssue || !credential) {
          return jsonResponse(
            { error: { code: "unknown", message: "Unexpected error occurred." } },
            { status: 500 },
          );
        }
        issueCount += 1;
        credentials = [credential, ...credentials];
        return jsonResponse({ credential, token: issuedToken }, { status: 201 });
      }

      return new Response(null, { status: 404 });
    },
    { authenticated: true },
  );

  return {
    fetchMock,
    setCredentials: (next: ShortcutCredential[]) => {
      credentials = next;
    },
    failToList: () => {
      canList = false;
    },
  };
};

const issueRequests = (fetchMock: ReturnType<typeof mockShortcutFetch>["fetchMock"]) =>
  fetchMock.mock.calls
    .filter(
      ([input, init]) =>
        getRequestPath(input) === "/api/shortcut-credentials" && init?.method === "POST",
    )
    .map(([, init]) => JSON.parse(String(init?.body)) as { name: string });

// iOSはショートカットAppへ移っている間にアプリを閉じることがある。開き直したときと同じに描き直す。
const reopenApp = async (path = "/settings/share") => {
  cleanup();
  return renderApp(path);
};

// ショートカットAppやSafariから戻ってきたことにする。
const returnToApp = () =>
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });

describe("共有から取り込む", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    focusManager.setFocused(undefined);
  });

  it("まだ連携していないiPhoneでは、発行を待たずにコピーを始め、コピーしてからショートカットの追加へ進める", async () => {
    vi.stubEnv("VITE_IOS_SHARE_SHORTCUT_URL", shortcutUrl);
    let releaseWrite = () => {};
    const device = installDevice({
      holdWrite: new Promise<void>((resolve) => {
        releaseWrite = resolve;
      }),
    });
    let releaseIssue = () => {};
    const { fetchMock } = mockShortcutFetch({
      holdIssue: new Promise<void>((resolve) => {
        releaseIssue = resolve;
      }),
    });

    await renderApp("/settings/share");

    expect(
      await screen.findByRole("heading", { name: "このiPhoneで設定する" }),
    ).toBeInTheDocument();
    // キーがないまま追加すると貼るものがないので、コピーするまでは押せない。
    expect(screen.getByRole("button", { name: "ショートカットを追加" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "ショートカットを追加" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "キーをコピー" }));

    // Safariはタップの処理の外で始めた書き込みを断るので、発行の応答より前に書き込みを始めている。
    expect(device.write).toHaveBeenCalledTimes(1);
    expect(device.copied).toEqual([]);

    releaseIssue();
    await vi.waitFor(() => {
      expect(device.requested).toEqual([issuedToken]);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    // 発行できても、コピーを終えるまでは次へ進めず、共有も待たない。
    expect(screen.getByRole("button", { name: "ショートカットを追加" })).toBeDisabled();
    expect(screen.queryByText("共有を待っています")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /キーを発行しました/ })).not.toBeInTheDocument();

    releaseWrite();

    await expect(
      screen.findByRole("heading", { name: /キーをコピーしました/ }),
    ).resolves.toBeInTheDocument();
    expect(device.copied).toEqual([issuedToken]);
    expect(issueRequests(fetchMock)).toEqual([{ name: "iPhone" }]);
    expect(screen.getByRole("link", { name: "ショートカットを追加" })).toHaveAttribute(
      "href",
      shortcutUrl,
    );
    // キーは貼り付けに使うだけなので、コピーできたときは画面に出さない。
    expect(screen.queryByLabelText("連携キー")).not.toBeInTheDocument();
  });

  it("発行したキーにまだ共有が届いていなければ、開き直しても共有を待つところから続ける", async () => {
    vi.stubEnv("VITE_IOS_SHARE_SHORTCUT_URL", shortcutUrl);
    installDevice();
    mockShortcutFetch({ credentials: [issuedCredential] });

    await renderApp("/settings/share");

    await expect(
      screen.findByRole("heading", { name: /キーを発行しました/ }),
    ).resolves.toBeInTheDocument();
    expect(screen.getByText(/末尾 a1B2/)).toBeInTheDocument();
    expect(screen.getByText("共有を待っています")).toBeInTheDocument();
    // もう追加したかどうかは分からないので、まだなら追加できるようにしておく。
    expect(screen.getByRole("link", { name: "ショートカットを追加" })).toHaveAttribute(
      "href",
      shortcutUrl,
    );
    expect(screen.getByRole("button", { name: "キーを発行し直す" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "キーをコピー" })).not.toBeInTheDocument();
  });

  it("共有を待っている間は、画面が見えたままでも、共有が届いたら連携できたことを伝える", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installDevice();
    const shortcut = mockShortcutFetch({ credentials: [issuedCredential] });

    await renderApp("/settings/share");
    await screen.findByText("共有を待っています");

    // iPadのSplit Viewでは、隣のアプリから共有してもこの画面は隠れず、アプリへ戻ったことにならない。
    shortcut.setCredentials([usedCredential(issuedCredential)]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    await expect(
      screen.findByRole("heading", { name: "連携できました" }),
    ).resolves.toBeInTheDocument();
  });

  it("共有が届いたら連携できたことを伝え、次に開いたときは連携の管理を出す", async () => {
    installDevice();
    const shortcut = mockShortcutFetch();

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "キーをコピー" }));
    await screen.findByRole("heading", { name: /キーをコピーしました/ });

    shortcut.setCredentials([usedCredential(issuedCredential)]);
    await returnToApp();

    await expect(
      screen.findByRole("heading", { name: "連携できました" }),
    ).resolves.toBeInTheDocument();

    await reopenApp();

    await expect(screen.findByRole("list", { name: "連携キー" })).resolves.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "連携できました" })).not.toBeInTheDocument();
  });

  it("発行し直したあとで、前のキーを入れたショートカットから共有が届いても、連携できたことを伝える", async () => {
    installDevice();
    const previousCredential = unusedCredential({ id: "credential_old", tokenSuffix: "0ld1" });
    const shortcut = mockShortcutFetch({ credentials: [previousCredential] });

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "キーを発行し直す" }));
    await screen.findByRole("heading", { name: /キーをコピーしました/ });

    shortcut.setCredentials([issuedCredential, usedCredential(previousCredential)]);
    await returnToApp();

    await expect(
      screen.findByRole("heading", { name: "連携できました" }),
    ).resolves.toBeInTheDocument();
  });

  it("Safariで発行したキーで連携が済んでも、アプリで待っている画面で連携できたことを伝える", async () => {
    installDevice();
    const shortcut = mockShortcutFetch();

    await renderApp("/settings/share");
    await screen.findByRole("button", { name: "キーをコピー" });

    shortcut.setCredentials([
      usedCredential(unusedCredential({ id: "credential_safari", tokenSuffix: "sfr1" })),
    ]);
    await returnToApp();

    await expect(
      screen.findByRole("heading", { name: "連携できました" }),
    ).resolves.toBeInTheDocument();
  });

  it("コピーできなかったらキーを選べるように出し、読み直しに失敗してもそのまま出しておく", async () => {
    installDevice({ canWriteClipboard: false });
    const shortcut = mockShortcutFetch();

    const { queryClient } = await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "キーをコピー" }));

    await expect(
      screen.findByText("コピーできませんでした。下のキーを選んでコピーしてください。"),
    ).resolves.toBeInTheDocument();
    expect(screen.getByLabelText("連携キー")).toHaveValue(issuedToken);

    shortcut.failToList();
    await returnToApp();

    await vi.waitFor(() => {
      expect(queryClient.getQueryState(shortcutCredentialsQueryKey)?.status).toBe("error");
    });
    // 失敗はsetTimeout(0)でまとめて画面へ届く。届けたあとの画面を見る。
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.getByLabelText("連携キー")).toHaveValue(issuedToken);
    expect(screen.queryByText("連携の状態を読み込めませんでした。")).not.toBeInTheDocument();
  });

  it("キーを発行できなければ知らせ、次の手順へ進めない", async () => {
    const device = installDevice();
    mockShortcutFetch({ canIssue: false });

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "キーをコピー" }));

    await expect(
      screen.findByText("連携キーを発行できませんでした。時間をおいて再度お試しください。"),
    ).resolves.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "キーをコピー" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "ショートカットを追加" })).toBeDisabled();
    expect(device.copied).toEqual([]);
  });

  it("初めての設定では置き換えを案内せず、やり直したら、もう追加したショートカットを置き換えるよう伝える", async () => {
    installDevice();
    mockShortcutFetch();

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "キーをコピー" }));
    await screen.findByRole("heading", { name: /キーをコピーしました/ });
    expect(screen.queryByText(replaceShortcutGuide)).not.toBeInTheDocument();

    const forgotKey = screen.getByText("キーを貼り忘れた・違うものを貼った").closest("details");
    if (!forgotKey) throw new Error("troubleshooting item not found");
    await userEvent.click(within(forgotKey).getByRole("button", { name: "最初からやり直す" }));

    expect(screen.getByRole("button", { name: "キーをコピー" })).toBeInTheDocument();
    expect(screen.getByText(replaceShortcutGuide)).toBeInTheDocument();
  });

  it("連携し直しに来たら、使ったことのあるキーがあっても理由と入れ直す手順を出し、新しいキーに共有が届いたら連携できたことを伝える", async () => {
    installDevice();
    const linkedCredential = shortcutCredentialFixture();
    const shortcut = mockShortcutFetch({ credentials: [linkedCredential] });

    const { appRouter } = await renderApp("/settings/share?reason=unauthorized");

    await expect(
      screen.findByText("ショートカットのキーが使えません"),
    ).resolves.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /ショートカットを入れ直す/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "連携できました" })).not.toBeInTheDocument();
    await vi.waitFor(() => {
      expect(appRouter.state.location.search).toEqual({});
    });

    await userEvent.click(screen.getByRole("button", { name: "キーをコピー" }));
    await screen.findByRole("heading", { name: /キーをコピーしました/ });
    shortcut.setCredentials([usedCredential(issuedCredential), linkedCredential]);
    await returnToApp();

    await expect(
      screen.findByRole("heading", { name: "連携できました" }),
    ).resolves.toBeInTheDocument();
  });

  it("最後の連携キーを解除して未連携になったら設定を始め、新しいキーに共有が届いたら連携できたことを伝える", async () => {
    installDevice();
    const linkedCredential = usedCredential(shortcutCredentialFixture());
    const shortcut = mockShortcutFetch({ credentials: [linkedCredential] });

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "末尾 0001 のキーを解除" }));
    await userEvent.click(await screen.findByRole("button", { name: "解除" }));

    // 解除したキーのショートカットが残っているので、追加するときに聞かれたら置き換えてもらう。
    await expect(screen.findByText(replaceShortcutGuide)).resolves.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "キーをコピー" }));
    await screen.findByRole("heading", { name: /キーをコピーしました/ });
    shortcut.setCredentials([usedCredential(issuedCredential)]);
    await returnToApp();

    await expect(
      screen.findByRole("heading", { name: "連携できました" }),
    ).resolves.toBeInTheDocument();
  });

  it("連携していれば連携の管理を出し、この端末で追加するときだけ手順を出す", async () => {
    installDevice();
    mockShortcutFetch({ credentials: [shortcutCredentialFixture()] });

    await renderApp("/settings/share");

    await expect(
      screen.findByRole("heading", { name: "ほかの端末でも使うには" }),
    ).resolves.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "このiPhoneでショートカットを追加する" }),
    );

    expect(screen.getByRole("heading", { name: "このiPhoneで設定する" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "キーをコピー" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "やめる" }));

    await expect(screen.findByRole("list", { name: "連携キー" })).resolves.toBeInTheDocument();
  });

  it("使ったキーと、共有が届いていないキーを分けて並べる", async () => {
    installDevice();
    mockShortcutFetch({
      credentials: [
        usedCredential(shortcutCredentialFixture()),
        unusedCredential({ id: "credential_0002", name: "iPad", tokenSuffix: "0002" }),
      ],
    });

    await renderApp("/settings/share");

    const usedKeys = await screen.findByRole("list", { name: "連携キー" });
    expect(within(usedKeys).getByRole("listitem")).toHaveTextContent(
      "iPhoneで設定最後に使ったのは今日 · 末尾 0001",
    );
    const unusedKeys = screen.getByRole("list", { name: "使われていないキー" });
    expect(within(unusedKeys).getByRole("listitem")).toHaveTextContent("iPadで発行");
    expect(within(unusedKeys).getByRole("listitem")).toHaveTextContent(/に発行 · 末尾 0002$/);
  });

  it("iPadのSafariがMacを名乗っていても、iPadとして連携する", async () => {
    installDevice({ userAgent: iPadDesktopUserAgent, maxTouchPoints: 5 });
    const { fetchMock } = mockShortcutFetch();

    await renderApp("/settings/share");
    await userEvent.click(await screen.findByRole("button", { name: "キーをコピー" }));
    await screen.findByRole("heading", { name: /キーをコピーしました/ });

    expect(screen.getByRole("heading", { name: "このiPadで設定する" })).toBeInTheDocument();
    expect(issueRequests(fetchMock)).toEqual([{ name: "iPad" }]);
  });

  it("Androidでは、ホーム画面に追加すれば共有メニューに出ることを伝え、キーを発行しない", async () => {
    installDevice({ userAgent: androidUserAgent });
    mockShortcutFetch();

    await renderApp("/settings/share");

    await expect(
      screen.findByText(
        /Androidでは、Recipe Stockをホーム画面に追加すると、共有メニューに出てきます/,
      ),
    ).resolves.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "キーをコピー" })).not.toBeInTheDocument();
  });

  it("Macのブラウザでは、iPhoneで開くよう案内し、連携キーは解除できるように出す", async () => {
    installDevice({ userAgent: iPadDesktopUserAgent, maxTouchPoints: 0 });
    mockShortcutFetch({ credentials: [shortcutCredentialFixture()] });

    await renderApp("/settings/share");

    await expect(
      screen.findByRole("heading", { name: "iPhoneで設定します" }),
    ).resolves.toBeInTheDocument();
    expect(screen.getByLabelText("このページのURL")).toHaveValue(
      `${window.location.origin}/settings/share`,
    );
    expect(
      await screen.findByRole("button", { name: "末尾 0001 のキーを解除" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "キーをコピー" })).not.toBeInTheDocument();
  });
});

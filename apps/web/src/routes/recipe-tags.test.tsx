import { focusManager } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tagsQueryKeys } from "../features/tags";
import {
  findFetchCall,
  getRequestPath,
  jsonResponse,
  mockFetch,
  renderApp,
} from "../test/router-test-utils";

type TagFixture = { id: string; name: string; recipeCount: number };

const listItem = (id: string, title: string) => ({
  id,
  title,
  coverImageUrl: null,
  sourceName: null,
  createdAt: "2026-05-25T00:00:00.000Z",
  locked: false,
});

const detailResponse = (tags: { id: string; name: string }[]) => ({
  recipe: {
    id: "recipe_1",
    title: "Tomato pasta",
    content: { title: "Tomato pasta", ingredientGroups: [], steps: [] },
    source: { sourceUrl: null, normalizedSourceUrl: null, sourceName: null },
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
    tags,
    locked: false,
  },
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
};

const tagVocabulary: TagFixture[] = [
  { id: "tag_1", name: "主菜", recipeCount: 0 },
  { id: "tag_2", name: "副菜", recipeCount: 0 },
];

const vocabularyTagsNamed = (names: readonly string[]) =>
  names.flatMap((name) => {
    const tag = tagVocabulary.find((candidate) => candidate.name === name);
    return tag ? [{ id: tag.id, name: tag.name }] : [];
  });

const requestedTagNames = (init: RequestInit | undefined) =>
  (JSON.parse(String(init?.body)) as { names: string[] }).names;

const savedTagSets = (fetchMock: ReturnType<typeof mockFetch>) =>
  fetchMock.mock.calls
    .filter(
      ([input, init]) =>
        getRequestPath(input) === "/api/recipes/recipe_1/tags" && init?.method === "PUT",
    )
    .map(([, init]) => requestedTagNames(init));

const serverErrorResponse = () =>
  jsonResponse(
    { error: { code: "unknown", message: "Unexpected error occurred." } },
    { status: 500 },
  );

const requestBodyOf = (fetchMock: ReturnType<typeof mockFetch>, path: string, method: string) => {
  const call = fetchMock.mock.calls.find(
    ([input, init]) => getRequestPath(input) === path && init?.method === method,
  );

  return call ? JSON.parse(String(call[1]?.body)) : undefined;
};

// /tags の行に出ているタグ名を、並んでいる順に読む。
const listedTagNames = () =>
  within(screen.getByRole("list", { name: "タグ" }))
    .getAllByRole("listitem")
    .map((item) => item.querySelector("p")?.textContent);

// URLのtagsはTanStack RouterがJSONとして書く。
const recipesPathWithTags = (tagIds: string[]) =>
  `/recipes?tags=${encodeURIComponent(JSON.stringify(tagIds))}`;

describe("タグ", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    focusManager.setFocused(undefined);
  });

  describe("一覧のチップ列", () => {
    it("チップを選ぶとタグをANDで重ねて絞り込み、URLに残す", async () => {
      const fetchMock = mockFetch(
        async (input) => {
          const path = getRequestPath(input);

          if (path === "/api/tags") {
            return jsonResponse({
              tags: [
                { id: "tag_1", name: "鶏肉", recipeCount: 2 },
                { id: "tag_2", name: "作り置き", recipeCount: 1 },
                { id: "tag_3", name: "お菓子", recipeCount: 0 },
              ],
            });
          }

          if (path === "/api/recipes?limit=20" || path === "/api/recipes?limit=20&tagId=tag_1") {
            return jsonResponse({
              items: [listItem("recipe_1", "Tomato pasta"), listItem("recipe_2", "Potato salad")],
              nextCursor: null,
            });
          }

          if (path === "/api/recipes?limit=20&tagId=tag_1&tagId=tag_2") {
            return jsonResponse({
              items: [listItem("recipe_1", "Tomato pasta")],
              nextCursor: null,
            });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      const { appRouter } = await renderApp("/recipes");
      const filterBar = await screen.findByRole("group", { name: "タグで絞り込む" });

      // 付いているRecipeがないタグは並べない。
      expect(within(filterBar).queryByRole("button", { name: "お菓子" })).not.toBeInTheDocument();

      await userEvent.click(within(filterBar).getByRole("button", { name: "鶏肉" }));
      await userEvent.click(within(filterBar).getByRole("button", { name: "作り置き" }));

      await waitFor(() => {
        expect(appRouter.state.location.search).toEqual({ tags: ["tag_1", "tag_2"] });
      });
      await waitFor(() => {
        expect(screen.queryByRole("heading", { name: "Potato salad" })).not.toBeInTheDocument();
      });
      expect(within(filterBar).getByRole("button", { name: "鶏肉" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(
        findFetchCall(fetchMock, "/api/recipes?limit=20&tagId=tag_1&tagId=tag_2"),
      ).toBeDefined();
    });

    it("一覧でRecipeを削除すると、付いていたRecipeがなくなったタグのチップを外す", async () => {
      let deleted = false;
      mockFetch(
        async (input, init) => {
          const path = getRequestPath(input);

          if (path === "/api/tags") {
            return jsonResponse({
              tags: [
                { id: "tag_1", name: "鶏肉", recipeCount: deleted ? 0 : 1 },
                { id: "tag_2", name: "作り置き", recipeCount: 1 },
              ],
            });
          }

          if (path === "/api/recipes?limit=20") {
            return jsonResponse({
              items: deleted
                ? [listItem("recipe_2", "Potato salad")]
                : [listItem("recipe_1", "Tomato pasta"), listItem("recipe_2", "Potato salad")],
              nextCursor: null,
            });
          }

          if (path === "/api/recipes/recipe_1" && init?.method === "DELETE") {
            deleted = true;
            return jsonResponse({ ok: true });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      await renderApp("/recipes");
      const filterBar = await screen.findByRole("group", { name: "タグで絞り込む" });
      expect(within(filterBar).getByRole("button", { name: "鶏肉" })).toBeInTheDocument();

      await userEvent.click(
        await screen.findByRole("button", { name: "Tomato pastaの操作メニュー" }),
      );
      await userEvent.click(await screen.findByRole("menuitem", { name: "削除" }));
      const deleteDialog = await screen.findByRole("alertdialog", {
        name: "レシピを削除しますか？",
      });
      await userEvent.click(within(deleteDialog).getByRole("button", { name: "削除" }));

      await waitFor(() => {
        const refreshedFilterBar = screen.getByRole("group", { name: "タグで絞り込む" });
        expect(
          within(refreshedFilterBar).queryByRole("button", { name: "鶏肉" }),
        ).not.toBeInTheDocument();
        expect(
          within(refreshedFilterBar).getByRole("button", { name: "作り置き" }),
        ).toBeInTheDocument();
      });
    });

    it("タグなしを選ぶとタグの選択を外し、0件ならすべてのレシピに戻れる", async () => {
      mockFetch(
        async (input) => {
          const path = getRequestPath(input);

          if (path === "/api/tags") {
            return jsonResponse({ tags: [{ id: "tag_1", name: "鶏肉", recipeCount: 1 }] });
          }

          if (path === "/api/recipes?limit=20&tagId=tag_1" || path === "/api/recipes?limit=20") {
            return jsonResponse({
              items: [listItem("recipe_1", "Tomato pasta")],
              nextCursor: null,
            });
          }

          if (path === "/api/recipes?limit=20&untagged=true") {
            return jsonResponse({ items: [], nextCursor: null });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      const { appRouter } = await renderApp(recipesPathWithTags(["tag_1"]));
      const filterBar = await screen.findByRole("group", { name: "タグで絞り込む" });

      await userEvent.click(within(filterBar).getByRole("button", { name: "タグなし" }));

      await expect(
        screen.findByText("すべてのレシピにタグが付いています"),
      ).resolves.toBeInTheDocument();
      expect(appRouter.state.location.search).toEqual({ untagged: true });
      expect(within(filterBar).getByRole("button", { name: "鶏肉" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      await userEvent.click(screen.getByRole("button", { name: "すべてのレシピを表示" }));

      await expect(
        screen.findByRole("heading", { name: "Tomato pasta" }),
      ).resolves.toBeInTheDocument();
      expect(appRouter.state.location.search).toEqual({});
    });

    it("URLに残った消えたタグのidは、タグ一覧を読んでから外し、そのidでは一覧を取りに行かない", async () => {
      const fetchMock = mockFetch(
        async (input) => {
          const path = getRequestPath(input);

          if (path === "/api/tags") {
            return jsonResponse({ tags: [{ id: "tag_1", name: "鶏肉", recipeCount: 1 }] });
          }

          if (path === "/api/recipes?limit=20&tagId=tag_1") {
            return jsonResponse({
              items: [listItem("recipe_1", "Tomato pasta")],
              nextCursor: null,
            });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      const { appRouter } = await renderApp(recipesPathWithTags(["tag_gone", "tag_1"]));

      await expect(
        screen.findByRole("heading", { name: "Tomato pasta" }),
      ).resolves.toBeInTheDocument();
      expect(appRouter.state.location.search).toEqual({ tags: ["tag_1"] });
      expect(
        fetchMock.mock.calls.some(([input]) => getRequestPath(input).includes("tag_gone")),
      ).toBe(false);
    });

    it("古いタグ一覧がキャッシュにあっても、読み直してから新しいタグのidで絞り込む", async () => {
      const fetchMock = mockFetch(
        async (input) => {
          const path = getRequestPath(input);

          if (path === "/api/tags") {
            return jsonResponse({
              tags: [
                { id: "tag_1", name: "鶏肉", recipeCount: 1 },
                { id: "tag_new", name: "作り置き", recipeCount: 1 },
              ],
            });
          }

          if (path === "/api/recipes?limit=20&tagId=tag_new") {
            return jsonResponse({
              items: [listItem("recipe_1", "Tomato pasta")],
              nextCursor: null,
            });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      // 詳細で新しいタグを付け、そのタグから一覧を開いたときは、キャッシュにそのタグがまだない。
      const { appRouter } = await renderApp(recipesPathWithTags(["tag_new"]), (queryClient) => {
        queryClient.setQueryData<TagFixture[]>(tagsQueryKeys.all(), [
          { id: "tag_1", name: "鶏肉", recipeCount: 1 },
        ]);
      });

      await expect(
        screen.findByRole("heading", { name: "Tomato pasta" }),
      ).resolves.toBeInTheDocument();
      expect(appRouter.state.location.search).toEqual({ tags: ["tag_new"] });
      expect(findFetchCall(fetchMock, "/api/recipes?limit=20")).toBeUndefined();
    });

    it("タグを1つも持たない利用者にはチップ列を出さない", async () => {
      const fetchMock = mockFetch(
        async (input) => {
          const path = getRequestPath(input);

          if (path === "/api/tags") {
            return jsonResponse({ tags: [] });
          }

          if (path === "/api/recipes?limit=20") {
            return jsonResponse({
              items: [listItem("recipe_1", "Tomato pasta")],
              nextCursor: null,
            });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      await renderApp("/recipes");

      await screen.findByRole("heading", { name: "Tomato pasta" });
      await waitFor(() => {
        expect(findFetchCall(fetchMock, "/api/tags")).toBeDefined();
      });
      expect(screen.queryByRole("group", { name: "タグで絞り込む" })).not.toBeInTheDocument();
    });
  });

  describe("詳細のタグ", () => {
    it("候補を選ぶとタグの組を送り、付けたタグからそのタグで絞った一覧を開ける", async () => {
      let savedTags: { id: string; name: string }[] = [];
      const fetchMock = mockFetch(
        async (input, init) => {
          const path = getRequestPath(input);

          if (path === "/api/recipes/recipe_1/tags" && init?.method === "PUT") {
            savedTags = [{ id: "tag_1", name: "鶏肉" }];
            return jsonResponse({ tags: savedTags });
          }

          if (path === "/api/recipes/recipe_1") {
            return jsonResponse(detailResponse(savedTags));
          }

          if (path === "/api/tags") {
            return jsonResponse({
              tags: [{ id: "tag_1", name: "鶏肉", recipeCount: savedTags.length + 1 }],
            });
          }

          if (path === "/api/recipes?limit=20&tagId=tag_1") {
            return jsonResponse({
              items: [listItem("recipe_1", "Tomato pasta")],
              nextCursor: null,
            });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      const { appRouter } = await renderApp("/recipes/recipe_1");

      await userEvent.click(await screen.findByRole("button", { name: "タグを付ける" }));
      const sheet = await screen.findByRole("dialog", { name: "タグ" });
      await userEvent.click(await within(sheet).findByRole("button", { name: /^鶏肉/ }));

      await waitFor(() => {
        expect(requestBodyOf(fetchMock, "/api/recipes/recipe_1/tags", "PUT")).toEqual({
          names: ["鶏肉"],
        });
      });
      await waitFor(() => {
        expect(within(sheet).getByRole("button", { name: /^鶏肉/ })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      });

      await userEvent.click(within(sheet).getByRole("button", { name: "完了" }));
      await userEvent.click(await screen.findByRole("link", { name: "鶏肉" }));

      await waitFor(() => {
        expect(appRouter.state.location.pathname).toBe("/recipes");
      });
      expect(appRouter.state.location.search).toEqual({ tags: ["tag_1"] });
    });

    it("語彙が空なら定番候補を出し、入力した名前は揃えてから作って付ける", async () => {
      const fetchMock = mockFetch(
        async (input, init) => {
          const path = getRequestPath(input);

          if (path === "/api/recipes/recipe_1/tags" && init?.method === "PUT") {
            return jsonResponse({ tags: [{ id: "tag_9", name: "BBQ" }] });
          }

          if (path === "/api/recipes/recipe_1") {
            return jsonResponse(detailResponse([]));
          }

          if (path === "/api/tags") {
            return jsonResponse({ tags: [] satisfies TagFixture[] });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      await renderApp("/recipes/recipe_1");

      await userEvent.click(await screen.findByRole("button", { name: "タグを付ける" }));
      const sheet = await screen.findByRole("dialog", { name: "タグ" });

      await expect(
        within(sheet).findByRole("button", { name: "作り置き" }),
      ).resolves.toBeInTheDocument();

      await userEvent.type(within(sheet).getByLabelText("タグを探す・作る"), " #ＢＢＱ");
      expect(within(sheet).getByRole("button", { name: "「BBQ」を作成" })).toBeInTheDocument();
      await userEvent.keyboard("{Enter}");

      await waitFor(() => {
        expect(requestBodyOf(fetchMock, "/api/recipes/recipe_1/tags", "PUT")).toEqual({
          names: ["BBQ"],
        });
      });
      expect(within(sheet).getByLabelText("タグを探す・作る")).toHaveValue("");
    });

    it("サーバー側の失敗は送り直し、それでも保存できなければ詳細を取り直してエラーを出す", async () => {
      let detailRequests = 0;
      let putRequests = 0;
      mockFetch(
        async (input, init) => {
          const path = getRequestPath(input);

          if (path === "/api/recipes/recipe_1/tags" && init?.method === "PUT") {
            putRequests += 1;
            return serverErrorResponse();
          }

          if (path === "/api/recipes/recipe_1") {
            detailRequests += 1;
            return jsonResponse(detailResponse([]));
          }

          if (path === "/api/tags") {
            return jsonResponse({ tags: [{ id: "tag_1", name: "鶏肉", recipeCount: 1 }] });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      await renderApp("/recipes/recipe_1");

      await userEvent.click(await screen.findByRole("button", { name: "タグを付ける" }));
      const sheet = await screen.findByRole("dialog", { name: "タグ" });
      await userEvent.click(await within(sheet).findByRole("button", { name: /^鶏肉/ }));

      await expect(within(sheet).findByRole("alert")).resolves.toHaveTextContent(
        "タグを保存できませんでした。",
      );
      expect(putRequests).toBe(3);
      await waitFor(() => {
        expect(detailRequests).toBe(2);
      });
      await waitFor(() => {
        expect(within(sheet).getByRole("button", { name: /^鶏肉/ })).toHaveAttribute(
          "aria-pressed",
          "false",
        );
      });
    });

    it("保存より前に始まった詳細の取得が保存の後に届いても、付けたタグを外さず次の組にも残す", async () => {
      let savedNames: string[] = [];
      let detailRequests = 0;
      const staleDetail = deferred();
      const fetchMock = mockFetch(
        async (input, init) => {
          const path = getRequestPath(input);

          if (path === "/api/recipes/recipe_1/tags" && init?.method === "PUT") {
            savedNames = requestedTagNames(init);
            return jsonResponse({ tags: vocabularyTagsNamed(savedNames) });
          }

          if (path === "/api/recipes/recipe_1") {
            detailRequests += 1;
            const response = jsonResponse(detailResponse(vocabularyTagsNamed(savedNames)));

            // 2回目はアプリへ戻ったときの取得で、保存より前の状態を読んだまま遅れて届く。
            if (detailRequests === 2) {
              await staleDetail.promise;
            }

            return response;
          }

          if (path === "/api/tags") {
            return jsonResponse({ tags: tagVocabulary });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      const { queryClient } = await renderApp("/recipes/recipe_1");

      await userEvent.click(await screen.findByRole("button", { name: "タグを付ける" }));
      const sheet = await screen.findByRole("dialog", { name: "タグ" });
      await within(sheet).findByRole("button", { name: /^主菜/ });

      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await waitFor(() => {
        expect(detailRequests).toBe(2);
      });

      await userEvent.click(within(sheet).getByRole("button", { name: /^主菜/ }));
      await waitFor(() => {
        expect(queryClient.isMutating()).toBe(0);
      });
      await act(async () => {
        staleDetail.resolve();
      });

      expect(within(sheet).getByRole("button", { name: /^主菜/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await userEvent.click(within(sheet).getByRole("button", { name: /^副菜/ }));

      await waitFor(() => {
        expect(savedTagSets(fetchMock)).toEqual([["主菜"], ["主菜", "副菜"]]);
      });
    });

    it("保存中に古い詳細が届いても、続けて押した組は前に押した組に積み上げる", async () => {
      let savedNames: string[] = [];
      const firstSave = deferred();
      const fetchMock = mockFetch(
        async (input, init) => {
          const path = getRequestPath(input);

          if (path === "/api/recipes/recipe_1/tags" && init?.method === "PUT") {
            const names = requestedTagNames(init);

            if (names.length === 1) {
              await firstSave.promise;
            }

            savedNames = names;
            return jsonResponse({ tags: vocabularyTagsNamed(savedNames) });
          }

          if (path === "/api/recipes/recipe_1") {
            return jsonResponse(detailResponse(vocabularyTagsNamed(savedNames)));
          }

          if (path === "/api/tags") {
            return jsonResponse({ tags: tagVocabulary });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      const { queryClient } = await renderApp("/recipes/recipe_1");

      await userEvent.click(await screen.findByRole("button", { name: "タグを付ける" }));
      const sheet = await screen.findByRole("dialog", { name: "タグ" });
      await userEvent.click(await within(sheet).findByRole("button", { name: /^主菜/ }));
      await waitFor(() => {
        expect(savedTagSets(fetchMock)).toHaveLength(1);
      });

      // 最初の保存を待っている間に取り直しが走り、まだ何も付いていない詳細が届く。
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await waitFor(() => {
        expect(queryClient.getQueryState(["recipe", "recipe_1"])?.fetchStatus).toBe("idle");
      });

      expect(within(sheet).getByRole("button", { name: /^主菜/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await userEvent.click(within(sheet).getByRole("button", { name: /^副菜/ }));
      await act(async () => {
        firstSave.resolve();
      });

      await waitFor(() => {
        expect(savedTagSets(fetchMock)).toEqual([["主菜"], ["主菜", "副菜"]]);
      });
      await waitFor(() => {
        expect(within(sheet).getByRole("button", { name: /^副菜/ })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      });
      expect(within(sheet).getByRole("button", { name: /^主菜/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("途中の保存が失敗しても、後から押した組を保存できればエラーを出さない", async () => {
      let savedNames: string[] = [];
      const firstSave = deferred();
      const fetchMock = mockFetch(
        async (input, init) => {
          const path = getRequestPath(input);

          if (path === "/api/recipes/recipe_1/tags" && init?.method === "PUT") {
            const names = requestedTagNames(init);

            // 最初に押した組の保存は、送り直しても失敗する。
            if (names.length === 1) {
              await firstSave.promise;
              return serverErrorResponse();
            }

            savedNames = names;
            return jsonResponse({ tags: vocabularyTagsNamed(savedNames) });
          }

          if (path === "/api/recipes/recipe_1") {
            return jsonResponse(detailResponse(vocabularyTagsNamed(savedNames)));
          }

          if (path === "/api/tags") {
            return jsonResponse({ tags: tagVocabulary });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      const { queryClient } = await renderApp("/recipes/recipe_1");

      await userEvent.click(await screen.findByRole("button", { name: "タグを付ける" }));
      const sheet = await screen.findByRole("dialog", { name: "タグ" });
      await userEvent.click(await within(sheet).findByRole("button", { name: /^主菜/ }));
      await waitFor(() => {
        expect(savedTagSets(fetchMock)).toHaveLength(1);
      });
      await userEvent.click(within(sheet).getByRole("button", { name: /^副菜/ }));
      await act(async () => {
        firstSave.resolve();
      });

      await waitFor(() => {
        expect(queryClient.isMutating()).toBe(0);
      });
      expect(savedNames).toEqual(["主菜", "副菜"]);
      expect(within(sheet).getByRole("button", { name: /^副菜/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(within(sheet).queryByRole("alert")).not.toBeInTheDocument();
    });

    it("応答が届かない保存は時間で区切って送り直す", async () => {
      const timeouts: AbortController[] = [];
      vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
        const controller = new AbortController();
        timeouts.push(controller);
        return controller.signal;
      });
      let savedNames: string[] = [];
      let putRequests = 0;
      mockFetch(
        async (input, init) => {
          const path = getRequestPath(input);

          if (path === "/api/recipes/recipe_1/tags" && init?.method === "PUT") {
            putRequests += 1;

            // 最初の送信は応答が届かず、時間切れで打ち切られる。
            if (putRequests === 1) {
              return new Promise<Response>((_resolve, reject) => {
                init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
              });
            }

            savedNames = requestedTagNames(init);
            return jsonResponse({ tags: vocabularyTagsNamed(savedNames) });
          }

          if (path === "/api/recipes/recipe_1") {
            return jsonResponse(detailResponse(vocabularyTagsNamed(savedNames)));
          }

          if (path === "/api/tags") {
            return jsonResponse({ tags: tagVocabulary });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      const { queryClient } = await renderApp("/recipes/recipe_1");

      await userEvent.click(await screen.findByRole("button", { name: "タグを付ける" }));
      const sheet = await screen.findByRole("dialog", { name: "タグ" });
      await userEvent.click(await within(sheet).findByRole("button", { name: /^主菜/ }));
      await waitFor(() => {
        expect(putRequests).toBe(1);
      });

      act(() => {
        timeouts[0]?.abort(new DOMException("The operation timed out.", "TimeoutError"));
      });

      await waitFor(() => {
        expect(queryClient.isMutating()).toBe(0);
      });
      expect(putRequests).toBe(2);
      expect(savedNames).toEqual(["主菜"]);
      expect(within(sheet).queryByRole("alert")).not.toBeInTheDocument();
    });

    it("保存の応答が失敗でも、読み直した組が押した組と同じならエラーを出さない", async () => {
      let savedNames: string[] = [];
      mockFetch(
        async (input, init) => {
          const path = getRequestPath(input);

          // DBでは確定したが、応答は失敗として届く。
          if (path === "/api/recipes/recipe_1/tags" && init?.method === "PUT") {
            savedNames = requestedTagNames(init);
            return serverErrorResponse();
          }

          if (path === "/api/recipes/recipe_1") {
            return jsonResponse(detailResponse(vocabularyTagsNamed(savedNames)));
          }

          if (path === "/api/tags") {
            return jsonResponse({ tags: tagVocabulary });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      const { queryClient } = await renderApp("/recipes/recipe_1");

      await userEvent.click(await screen.findByRole("button", { name: "タグを付ける" }));
      const sheet = await screen.findByRole("dialog", { name: "タグ" });
      await userEvent.click(await within(sheet).findByRole("button", { name: /^主菜/ }));

      await waitFor(() => {
        expect(queryClient.isMutating()).toBe(0);
      });
      expect(within(sheet).getByRole("button", { name: /^主菜/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(within(sheet).queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("タグの管理", () => {
    it("既存のタグと同じ名前に変えると、まとめるか確かめてから統合する", async () => {
      const fetchMock = mockFetch(
        async (input, init) => {
          const path = getRequestPath(input);

          if (path === "/api/tags/tag_1" && init?.method === "PATCH") {
            return jsonResponse(
              {
                error: {
                  code: "tag_name_conflict",
                  message: "Tag name is already used.",
                  details: { tag: { id: "tag_2", name: "鶏肉" } },
                },
              },
              { status: 409 },
            );
          }

          if (path === "/api/tags/tag_1/merge" && init?.method === "POST") {
            return jsonResponse({ tag: { id: "tag_2", name: "鶏肉" } });
          }

          if (path === "/api/tags") {
            return jsonResponse({
              tags: [
                { id: "tag_2", name: "鶏肉", recipeCount: 3 },
                { id: "tag_1", name: "とり肉", recipeCount: 2 },
              ],
            });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      await renderApp("/tags");

      await userEvent.click(
        await screen.findByRole("button", { name: "「とり肉」の操作メニュー" }),
      );
      await userEvent.click(await screen.findByRole("menuitem", { name: "名前を変更" }));
      const nameInput = await screen.findByLabelText("「とり肉」の新しい名前");
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, "鶏肉");
      await userEvent.click(screen.getByRole("button", { name: "保存" }));

      const mergeDialog = await screen.findByRole("alertdialog", {
        name: "「とり肉」を「鶏肉」にまとめますか？",
      });
      await userEvent.click(within(mergeDialog).getByRole("button", { name: "まとめる" }));

      await waitFor(() => {
        expect(requestBodyOf(fetchMock, "/api/tags/tag_1/merge", "POST")).toEqual({
          intoTagId: "tag_2",
        });
      });
      expect(requestBodyOf(fetchMock, "/api/tags/tag_1", "PATCH")).toEqual({ name: "鶏肉" });
    });

    it("先頭に移動すると並び全体を送り、その並びで出す", async () => {
      let tags: TagFixture[] = [
        { id: "tag_1", name: "主菜", recipeCount: 3 },
        { id: "tag_2", name: "作り置き", recipeCount: 1 },
        { id: "tag_3", name: "お弁当", recipeCount: 1 },
      ];
      const fetchMock = mockFetch(
        async (input, init) => {
          const path = getRequestPath(input);

          if (path === "/api/tags/order" && init?.method === "PUT") {
            const { tagIds } = JSON.parse(String(init.body)) as { tagIds: string[] };
            tags = tagIds.flatMap((tagId) => tags.find((tag) => tag.id === tagId) ?? []);
            return jsonResponse({ ok: true });
          }

          if (path === "/api/tags") {
            return jsonResponse({ tags });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      await renderApp("/tags");

      await userEvent.click(
        await screen.findByRole("button", { name: "「お弁当」の操作メニュー" }),
      );
      await userEvent.click(await screen.findByRole("menuitem", { name: "先頭に移動" }));

      await waitFor(() => {
        expect(requestBodyOf(fetchMock, "/api/tags/order", "PUT")).toEqual({
          tagIds: ["tag_3", "tag_1", "tag_2"],
        });
      });
      await waitFor(() => {
        expect(listedTagNames()).toEqual(["お弁当", "主菜", "作り置き"]);
      });
    });

    it("並びを変えられなければエラーを出し、元の並びに戻す", async () => {
      const tags: TagFixture[] = [
        { id: "tag_1", name: "主菜", recipeCount: 3 },
        { id: "tag_2", name: "作り置き", recipeCount: 1 },
      ];
      mockFetch(
        async (input, init) => {
          const path = getRequestPath(input);

          if (path === "/api/tags/order" && init?.method === "PUT") {
            return jsonResponse(
              { error: { code: "unknown", message: "Failed to reorder tags." } },
              { status: 500 },
            );
          }

          if (path === "/api/tags") {
            return jsonResponse({ tags });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      await renderApp("/tags");

      await userEvent.click(
        await screen.findByRole("button", { name: "「作り置き」の操作メニュー" }),
      );
      await userEvent.click(await screen.findByRole("menuitem", { name: "上に移動" }));

      await expect(
        screen.findByText("タグの並びを変えられませんでした。"),
      ).resolves.toBeInTheDocument();
      await waitFor(() => {
        expect(listedTagNames()).toEqual(["主菜", "作り置き"]);
      });
    });

    it("削除したタグは、一覧へ戻るときに引き継ぐ絞り込みからも外す", async () => {
      let tags: TagFixture[] = [{ id: "tag_1", name: "鶏肉", recipeCount: 2 }];
      mockFetch(
        async (input, init) => {
          const path = getRequestPath(input);

          if (path === "/api/tags/tag_1" && init?.method === "DELETE") {
            tags = [];
            return jsonResponse({ ok: true });
          }

          if (path === "/api/tags") {
            return jsonResponse({ tags });
          }

          if (path === "/api/recipes?limit=20&tagId=tag_1" || path === "/api/recipes?limit=20") {
            return jsonResponse({
              items: [listItem("recipe_1", "Tomato pasta")],
              nextCursor: null,
            });
          }

          return new Response(null, { status: 404 });
        },
        { authenticated: true },
      );

      const { appRouter } = await renderApp(recipesPathWithTags(["tag_1"]));

      await userEvent.click(await screen.findByRole("link", { name: "タグを管理" }));
      await userEvent.click(await screen.findByRole("button", { name: "「鶏肉」の操作メニュー" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "削除" }));
      const deleteDialog = await screen.findByRole("alertdialog", {
        name: "「鶏肉」を削除しますか？",
      });
      expect(deleteDialog).toHaveTextContent("付いている2件のレシピから外れます。");
      await userEvent.click(within(deleteDialog).getByRole("button", { name: "削除" }));

      await expect(screen.findByText("タグはまだありません")).resolves.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "レシピ一覧へ戻る" }));

      await waitFor(() => {
        expect(appRouter.state.location.pathname).toBe("/recipes");
      });
      expect(appRouter.state.location.search).toEqual({});
    });
  });
});

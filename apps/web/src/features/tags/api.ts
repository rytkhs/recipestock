import {
  type DeleteTagResponse,
  type ListTagsResponse,
  type MergeTagResponse,
  type RenameTagResponse,
  type ReorderTagsResponse,
  type ReplaceRecipeTagsResponse,
} from "@recipestock/schemas";
import { api, parseApiResponse } from "../../lib/api";

// 応答が届かないまま待つと、同じRecipeへ後から押した組も送れずに溜まる。
// 保存と、保存に失敗した後の読み直しは、この時間で区切る。
export const RECIPE_TAGS_SAVE_TIMEOUT_MS = 10_000;

// パスパラメータのあるルートは、RPCの型が本文を受け付けないので、レシピの更新と同じくfetchで送る。
const sendJson = (
  method: "PUT" | "PATCH" | "POST",
  path: string,
  body: unknown,
  init?: Pick<RequestInit, "signal">,
) =>
  fetch(path, {
    ...init,
    method,
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const listTags = async () => {
  const body = await parseApiResponse<ListTagsResponse>(api.api.tags.$get());
  return body.tags;
};

// タグの組を丸ごと置き換える。名前で送るので、新しいタグの作成も同じ要求で済む。
export const replaceRecipeTags = async (recipeId: string, names: readonly string[]) => {
  const body = await parseApiResponse<ReplaceRecipeTagsResponse>(
    sendJson(
      "PUT",
      `/api/recipes/${encodeURIComponent(recipeId)}/tags`,
      { names },
      { signal: AbortSignal.timeout(RECIPE_TAGS_SAVE_TIMEOUT_MS) },
    ),
  );
  return body.tags;
};

// 並びは全体を送って置き換える。送らなかったタグは後ろに残る。
export const reorderTags = async (tagIds: readonly string[]) =>
  parseApiResponse<ReorderTagsResponse>(sendJson("PUT", "/api/tags/order", { tagIds }));

export const renameTag = async (tagId: string, name: string) => {
  const body = await parseApiResponse<RenameTagResponse>(
    sendJson("PATCH", `/api/tags/${encodeURIComponent(tagId)}`, { name }),
  );
  return body.tag;
};

export const mergeTag = async (tagId: string, intoTagId: string) => {
  const body = await parseApiResponse<MergeTagResponse>(
    sendJson("POST", `/api/tags/${encodeURIComponent(tagId)}/merge`, { intoTagId }),
  );
  return body.tag;
};

export const deleteTag = async (tagId: string) =>
  parseApiResponse<DeleteTagResponse>(
    fetch(`/api/tags/${encodeURIComponent(tagId)}`, {
      method: "DELETE",
      credentials: "include",
    }),
  );

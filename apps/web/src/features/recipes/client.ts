import {
  type CreateRecipeRequest,
  type CreateRecipeResponse,
  type DeleteRecipeResponse,
  type GetRecipeResponse,
  type ListRecipesResponse,
  type RecipeDraftContent,
  type UpdateRecipeResponse,
} from "@recipestock/schemas";
import { api, parseApiResponse } from "../../lib/api";

export const createRecipe = async (request: CreateRecipeRequest) => {
  return parseApiResponse<CreateRecipeResponse>(
    api.api.recipes.$post({
      json: request,
    }),
  );
};

export const updateRecipe = async (recipeId: string, content: RecipeDraftContent) => {
  return parseApiResponse<UpdateRecipeResponse>(
    fetch(`/api/recipes/${encodeURIComponent(recipeId)}`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),
  );
};

export const deleteRecipe = async (recipeId: string) => {
  return parseApiResponse<DeleteRecipeResponse>(
    fetch(`/api/recipes/${encodeURIComponent(recipeId)}`, {
      method: "DELETE",
      credentials: "include",
    }),
  );
};

export const getRecipe = async (recipeId: string) => {
  const body = await parseApiResponse<GetRecipeResponse>(
    api.api.recipes[":recipeId"].$get({
      param: { recipeId },
    }),
  );
  return body.recipe;
};

export const listRecipes = async ({
  cursor,
  query,
}: {
  cursor?: string | null;
  query?: string;
}) => {
  return parseApiResponse<ListRecipesResponse>(
    api.api.recipes.$get({
      query: {
        limit: "20",
        ...(query ? { q: query } : {}),
        ...(cursor ? { cursor } : {}),
      },
    }),
  );
};

import { type QueryClient } from "@tanstack/react-query";
import { viewerQueryKey } from "./viewer";

const userScopedQueryKeys = new Set([viewerQueryKey[0], "recipe", "recipes"]);

export const clearUserScopedCache = (queryClient: QueryClient) => {
  queryClient.removeQueries({
    predicate: (query) => userScopedQueryKeys.has(String(query.queryKey[0])),
  });
};

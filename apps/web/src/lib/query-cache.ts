import { type QueryClient } from "@tanstack/react-query";
import { recipesUserScopedQueryRoots } from "../features/recipes";
import { viewerQueryKey } from "./viewer";

const userScopedQueryKeys = new Set<string>([viewerQueryKey[0], ...recipesUserScopedQueryRoots]);

export const clearUserScopedCache = (queryClient: QueryClient) => {
  queryClient.removeQueries({
    predicate: (query) => userScopedQueryKeys.has(String(query.queryKey[0])),
  });
};

import { type QueryClient } from "@tanstack/react-query";
import { pushSubscriptionsQueryKey } from "../features/push-notifications/api";
import { recipesUserScopedQueryRoots } from "../features/recipes";
import { billingStatusQueryKey } from "./billing";
import { viewerQueryKey } from "./viewer";

const userScopedQueryKeys = new Set<string>([
  viewerQueryKey[0],
  billingStatusQueryKey[0],
  pushSubscriptionsQueryKey[0],
  ...recipesUserScopedQueryRoots,
]);

export const clearUserScopedCache = (
  queryClient: QueryClient,
  { keepViewer = false }: { keepViewer?: boolean } = {},
) => {
  queryClient.removeQueries({
    predicate: (query) => {
      const root = String(query.queryKey[0]);
      if (keepViewer && root === viewerQueryKey[0]) return false;
      return userScopedQueryKeys.has(root);
    },
  });
};

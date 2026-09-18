import { type QueryClient } from "@tanstack/react-query";
import { shortcutCredentialsQueryKey } from "../features/ios-share/api";
import { pushSubscriptionsQueryKey } from "../features/push-notifications/api";
import { recipesUserScopedQueryRoots } from "../features/recipes";
import { tagsUserScopedQueryRoots } from "../features/tags";
import { billingStatusQueryKey } from "./billing";
import { viewerQueryKey } from "./viewer";

const userScopedQueryKeys = new Set<string>([
  viewerQueryKey[0],
  billingStatusQueryKey[0],
  pushSubscriptionsQueryKey[0],
  shortcutCredentialsQueryKey[0],
  ...recipesUserScopedQueryRoots,
  ...tagsUserScopedQueryRoots,
]);

export const clearUserScopedCache = (queryClient: QueryClient) => {
  queryClient.removeQueries({
    predicate: (query) => userScopedQueryKeys.has(String(query.queryKey[0])),
  });
};

import { Button } from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useNavigate,
} from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { ApiClientError } from "../lib/api";
import { signOut, useAuthSession } from "../lib/auth";
import { clearUserScopedCache } from "../lib/query-cache";
import { useViewer } from "../lib/viewer";
import { ImportIndexRoute, ImportUrlRoute } from "./import";
import { LoginRoute } from "./login";
import { EditRecipeRoute, NewRecipeRoute, RecipeDetailRoute, RecipesIndexRoute } from "./recipes";
import { SettingsBillingRoute, SettingsIndexRoute } from "./settings";

const LoadingPage = () => (
  <section className="mx-auto w-full max-w-5xl px-6 py-10">
    <p className="text-default-600">読み込み中</p>
  </section>
);

const RequireViewer = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const session = useAuthSession();
  const viewer = useViewer({ enabled: Boolean(session.data) });
  const navigate = useNavigate();

  useEffect(() => {
    if (!session.isPending && !session.data) {
      void navigate({ to: "/login", replace: true });
    }
  }, [navigate, session.data, session.isPending]);

  useEffect(() => {
    if (!(viewer.error instanceof ApiClientError) || viewer.error.code !== "unauthorized") {
      return;
    }

    clearUserScopedCache(queryClient);
    void session.refetch().finally(() => {
      void navigate({ to: "/login", replace: true });
    });
  }, [navigate, queryClient, session, viewer.error]);

  if (session.isPending || (session.data && viewer.isPending)) {
    return <LoadingPage />;
  }

  if (!session.data || !viewer.data) {
    return null;
  }

  return children;
};

const RedirectAuthenticated = ({ children }: { children: ReactNode }) => {
  const session = useAuthSession();
  const navigate = useNavigate();
  const isInitialPending = session.isPending && !session.isRefetching;

  useEffect(() => {
    if (!session.isPending && session.data) {
      void navigate({ to: "/recipes", replace: true });
    }
  }, [navigate, session.data, session.isPending]);

  if (isInitialPending || session.data) {
    return <LoadingPage />;
  }

  return children;
};

const RootLayout = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useAuthSession();

  const handleSignOut = async () => {
    await signOut();
    clearUserScopedCache(queryClient);
    await session.refetch();
    await navigate({ to: "/login" });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex flex-col gap-4 border-border border-b bg-surface px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <Link className="font-bold text-lg no-underline" to="/">
          Recipe Stock
        </Link>
        <nav
          aria-label="Main navigation"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 text-default-700 text-sm"
        >
          <Link activeProps={{ className: "text-accent font-semibold" }} to="/recipes">
            Recipes
          </Link>
          <Link activeProps={{ className: "text-accent font-semibold" }} to="/import">
            Import
          </Link>
          <Link activeProps={{ className: "text-accent font-semibold" }} to="/settings">
            Settings
          </Link>
          {session.data ? (
            <Button size="sm" variant="ghost" onPress={() => void handleSignOut()}>
              ログアウト
            </Button>
          ) : (
            <Link activeProps={{ className: "text-accent font-semibold" }} to="/login">
              ログイン
            </Link>
          )}
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
};

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => (
    <RedirectAuthenticated>
      <section className="mx-auto w-full max-w-5xl px-6 py-10">
        <h1 className="font-semibold text-3xl">Recipe Stock</h1>
        <p className="mt-3 max-w-xl text-default-600">
          Import, confirm, save, search, and view recipes from one workspace.
        </p>
      </section>
    </RedirectAuthenticated>
  ),
});

const recipesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recipes",
  component: () => (
    <RequireViewer>
      <RecipesIndexRoute />
    </RequireViewer>
  ),
});

const newRecipeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recipes/new",
  component: () => (
    <RequireViewer>
      <NewRecipeRoute />
    </RequireViewer>
  ),
});

const recipeDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recipes/$recipeId",
  component: () => (
    <RequireViewer>
      <RecipeDetailRoute />
    </RequireViewer>
  ),
});

const editRecipeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recipes/$recipeId/edit",
  component: () => (
    <RequireViewer>
      <EditRecipeRoute />
    </RequireViewer>
  ),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: () => (
    <RedirectAuthenticated>
      <LoginRoute />
    </RedirectAuthenticated>
  ),
});

const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/import",
  component: () => (
    <RequireViewer>
      <ImportIndexRoute />
    </RequireViewer>
  ),
});

const importUrlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/import/url",
  component: () => (
    <RequireViewer>
      <ImportUrlRoute />
    </RequireViewer>
  ),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: () => (
    <RequireViewer>
      <SettingsIndexRoute />
    </RequireViewer>
  ),
});

const settingsBillingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/billing",
  component: () => (
    <RequireViewer>
      <SettingsBillingRoute />
    </RequireViewer>
  ),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  recipesRoute,
  newRecipeRoute,
  recipeDetailRoute,
  editRecipeRoute,
  importRoute,
  importUrlRoute,
  settingsRoute,
  settingsBillingRoute,
]);

type AppRouterOptions = Omit<Parameters<typeof createRouter>[0], "routeTree">;

export const createAppRouter = (options?: AppRouterOptions) =>
  createRouter({ routeTree, ...options });

const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export const AppRouter = ({ appRouter = router }: { appRouter?: typeof router }) => (
  <RouterProvider router={appRouter} />
);

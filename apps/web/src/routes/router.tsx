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
import { LoginRoute } from "./login";
import { NewRecipeRoute, RecipeDetailRoute, RecipesIndexRoute } from "./recipes";

const LoadingPage = () => (
  <section className="page">
    <p>読み込み中</p>
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
    <div className="app-shell">
      <header className="top-bar">
        <Link to="/" className="brand">
          Recipe Stock
        </Link>
        <nav aria-label="Main navigation">
          <Link to="/recipes">Recipes</Link>
          <Link to="/import">Import</Link>
          <Link to="/settings">Settings</Link>
          {session.data ? (
            <button className="text-button" type="button" onClick={() => void handleSignOut()}>
              ログアウト
            </button>
          ) : (
            <Link to="/login">ログイン</Link>
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
      <section className="page">
        <h1>Recipe Stock</h1>
        <p>Import, confirm, save, search, and view recipes from one workspace.</p>
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
      <section className="page">
        <h1>Import</h1>
      </section>
    </RequireViewer>
  ),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: () => (
    <RequireViewer>
      <section className="page">
        <h1>Settings</h1>
      </section>
    </RequireViewer>
  ),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  recipesRoute,
  newRecipeRoute,
  recipeDetailRoute,
  importRoute,
  settingsRoute,
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

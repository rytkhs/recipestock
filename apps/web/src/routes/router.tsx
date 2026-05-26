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
import { authSessionQueryKey, signOut, useSession } from "../lib/auth";
import { LoginRoute } from "./login";
import { NewRecipeRoute, RecipeDetailRoute, RecipesIndexRoute } from "./recipes";

const userScopedQueryKeys = new Set(["me", "recipe", "recipes"]);

const LoadingPage = () => (
  <section className="page">
    <p>読み込み中</p>
  </section>
);

const RequireAuth = ({ children }: { children: ReactNode }) => {
  const session = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!session.isPending && !session.data) {
      void navigate({ to: "/login", replace: true });
    }
  }, [navigate, session.data, session.isPending]);

  if (session.isPending) {
    return <LoadingPage />;
  }

  if (!session.data) {
    return null;
  }

  return children;
};

const RedirectAuthenticated = ({ children }: { children: ReactNode }) => {
  const session = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!session.isPending && session.data) {
      void navigate({ to: "/recipes", replace: true });
    }
  }, [navigate, session.data, session.isPending]);

  if (session.isPending || session.data) {
    return <LoadingPage />;
  }

  return children;
};

const RootLayout = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();

  const handleSignOut = async () => {
    await signOut();
    queryClient.setQueryData(authSessionQueryKey, null);
    await navigate({ to: "/login" });
    queryClient.removeQueries({
      predicate: (query) => userScopedQueryKeys.has(String(query.queryKey[0])),
    });
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
    <RequireAuth>
      <RecipesIndexRoute />
    </RequireAuth>
  ),
});

const newRecipeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recipes/new",
  component: () => (
    <RequireAuth>
      <NewRecipeRoute />
    </RequireAuth>
  ),
});

const recipeDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recipes/$recipeId",
  component: () => (
    <RequireAuth>
      <RecipeDetailRoute />
    </RequireAuth>
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
    <RequireAuth>
      <section className="page">
        <h1>Import</h1>
      </section>
    </RequireAuth>
  ),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: () => (
    <RequireAuth>
      <section className="page">
        <h1>Settings</h1>
      </section>
    </RequireAuth>
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

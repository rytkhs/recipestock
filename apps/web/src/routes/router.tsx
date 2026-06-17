import { useQueryClient } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useNavigate,
} from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { Header } from "../components/header";
import { ApiClientError } from "../lib/api";
import { useAuthSession } from "../lib/auth";
import { clearUserScopedCache } from "../lib/query-cache";
import { useViewer } from "../lib/viewer";
import { ImportUrlRoute } from "./import";
import { LoginRoute } from "./login";
import { EditRecipeRoute, NewRecipeRoute, RecipeDetailRoute, RecipesIndexRoute } from "./recipes";
import { SettingsBillingRoute, SettingsIndexRoute } from "./settings";

const LoadingPage = () => (
  <section className="mx-auto w-full max-w-[1120px] px-4 sm:px-6 lg:px-10 py-10">
    <div className="flex items-center gap-3">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-sage border-t-transparent" />
      <p className="text-brand-muted text-sm">読み込み中</p>
    </div>
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

const RootLayout = () => (
  <div className="min-h-screen bg-brand-cream text-brand-ink">
    <Header />
    <main className="pb-8">
      <Outlet />
    </main>
  </div>
);

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => (
    <RedirectAuthenticated>
      <section className="mx-auto w-full max-w-[1120px] px-4 sm:px-6 lg:px-10 py-16 text-center">
        <h1 className="text-brand-ink font-extrabold text-4xl sm:text-5xl tracking-tight">
          Recipe Stock
        </h1>
        <p className="mt-4 mx-auto max-w-xl text-brand-muted text-lg leading-relaxed">
          レシピサイト、YouTube、SNS、書籍、画像からレシピを取り込んで、ひとつの場所で検索・閲覧できるPWA
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

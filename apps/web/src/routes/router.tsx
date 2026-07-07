import { useQueryClient } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { Header, MobileBottomNav } from "../components/header";
import {
  ImportUrlSkeleton,
  RecipeDetailSkeleton,
  RecipeFormSkeleton,
  RecipeListSkeleton,
  SettingsSkeleton,
} from "../components/loading";
import { ApiClientError } from "../lib/api";
import { AuthStateProvider, useAuthState } from "../lib/auth-state";
import { clearUserScopedCache } from "../lib/query-cache";
import { isProtectedAppPath } from "../lib/route-access";
import { useViewer } from "../lib/viewer";
import { ImportUrlRoute } from "./import";
import { LoginRoute } from "./login";
import { EditRecipeRoute, NewRecipeRoute, RecipeDetailRoute, RecipesIndexRoute } from "./recipes";
import { SettingsBillingRoute, SettingsIndexRoute } from "./settings";

const ProtectedRouteSkeleton = () => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (pathname === "/recipes") {
    return <RecipeListSkeleton />;
  }

  if (pathname === "/recipes/new" || pathname.endsWith("/edit")) {
    return <RecipeFormSkeleton />;
  }

  if (pathname.startsWith("/recipes/")) {
    return <RecipeDetailSkeleton />;
  }

  if (pathname === "/import/url") {
    return <ImportUrlSkeleton />;
  }

  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return <SettingsSkeleton />;
  }

  return <RecipeListSkeleton />;
};

const RequireViewer = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const { session, status } = useAuthState();
  const viewer = useViewer({ enabled: status === "authenticated" });
  const navigate = useNavigate();

  useEffect(() => {
    if (status === "unauthenticated") {
      void navigate({ to: "/login", replace: true });
    }
  }, [navigate, status]);

  useEffect(() => {
    if (!(viewer.error instanceof ApiClientError) || viewer.error.code !== "unauthorized") {
      return;
    }

    clearUserScopedCache(queryClient);
    void session.refetch().finally(() => {
      void navigate({ to: "/login", replace: true });
    });
  }, [navigate, queryClient, session, viewer.error]);

  if (status === "pending" || (status === "authenticated" && viewer.isPending)) {
    return <ProtectedRouteSkeleton />;
  }

  if (status !== "authenticated" || !viewer.data) {
    return null;
  }

  return children;
};

const RedirectAuthenticated = ({ children }: { children: ReactNode }) => {
  const { status } = useAuthState();
  const navigate = useNavigate();

  useEffect(() => {
    if (status === "authenticated") {
      void navigate({ to: "/recipes", replace: true });
    }
  }, [navigate, status]);

  if (status === "pending" || status === "authenticated") {
    return null;
  }

  return children;
};

const RootLayoutContent = () => {
  const { status } = useAuthState();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const shouldReservePrivateChrome =
    status === "authenticated" || (status === "pending" && isProtectedAppPath(pathname));

  return (
    <div className="min-h-screen bg-brand-cream text-brand-ink">
      <Header />
      <main
        className={
          shouldReservePrivateChrome
            ? "pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:pb-8"
            : "pb-8"
        }
      >
        <Outlet />
      </main>
      <MobileBottomNav />
    </div>
  );
};

const RootLayout = () => (
  <AuthStateProvider>
    <RootLayoutContent />
  </AuthStateProvider>
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

import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  RouterProvider,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { ConnectionUnavailable } from "../components/connection-unavailable";
import { Header, MobileAddRecipeFab } from "../components/header";
import {
  ImportUrlSkeleton,
  LoadingStatus,
  RecipeDetailSkeleton,
  RecipeFormSkeleton,
  RecipeListSkeleton,
  SettingsSkeleton,
} from "../components/loading";
import { RouteChunkError } from "../components/route-chunk-error";
import { AuthStateProvider, useAuthState } from "../lib/auth-state";
import { useProtectedAccess } from "../lib/protected-access";
import { isProtectedAppPath, resolveAuthRedirect } from "../lib/route-access";
import { type ImportUrlSearch } from "./import";

const LoginScreen = lazyRouteComponent(() => import("./login"), "LoginRoute");
const ImportUrlScreen = lazyRouteComponent(() => import("./import"), "ImportUrlRoute");
const RecipesIndexRoute = lazyRouteComponent(() => import("./recipes-index"), "RecipesIndexRoute");
const NewRecipeRoute = lazyRouteComponent(() => import("./recipe-editor"), "NewRecipeRoute");
const EditRecipeRoute = lazyRouteComponent(() => import("./recipe-editor"), "EditRecipeRoute");
const RecipeDetailRoute = lazyRouteComponent(() => import("./recipe-detail"), "RecipeDetailRoute");
const SettingsIndexRoute = lazyRouteComponent(
  () => import("./settings-index"),
  "SettingsIndexRoute",
);
const SettingsBillingRoute = lazyRouteComponent(
  () => import("./settings-billing"),
  "SettingsBillingRoute",
);

const withPreload = <TProps,>(
  component: (props: TProps) => ReactNode,
  preload: (() => Promise<unknown>) | undefined,
) => Object.assign(component, { preload });

const LoginRoute = withPreload(
  ({ redirectTo }: { redirectTo: string }) => <LoginScreen redirectTo={redirectTo} />,
  LoginScreen.preload,
);
const ImportUrlRoute = withPreload(
  ({ search }: { search: ImportUrlSearch }) => <ImportUrlScreen search={search} />,
  ImportUrlScreen.preload,
);

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

const ProtectedLayout = () => {
  const access = useProtectedAccess();
  const navigate = useNavigate();
  const currentHref = useRouterState({ select: (state) => state.location.href });
  const currentPathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (access.status === "unauthenticated" && isProtectedAppPath(currentPathname)) {
      void navigate({
        to: "/login",
        search: { redirect: currentHref },
        replace: true,
      });
    }
  }, [access.status, currentHref, currentPathname, navigate]);

  const isReady = access.status === "ready";
  const isHome = currentPathname === "/recipes";

  return (
    <>
      <Header isMobileVisible={false} variant={isReady ? "private" : "brand"} />
      <main
        className={
          isReady && isHome ? "pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:pb-8" : "pb-8"
        }
      >
        {access.status === "pending" ? <ProtectedRouteSkeleton /> : null}
        {access.status === "ready" ? <Outlet /> : null}
        {access.status === "unavailable" ? (
          <ConnectionUnavailable isRetrying={access.isRetrying} onRetry={access.retry} />
        ) : null}
      </main>
      {isReady && isHome ? <MobileAddRecipeFab /> : null}
    </>
  );
};

const RedirectAuthenticated = ({
  children,
  redirectTo = "/recipes",
}: {
  children: ReactNode;
  redirectTo?: string;
}) => {
  const { status } = useAuthState();
  const navigate = useNavigate();

  useEffect(() => {
    if (status === "authenticated") {
      void navigate({ href: redirectTo, replace: true });
    }
  }, [navigate, redirectTo, status]);

  if (status === "pending" || status === "authenticated") {
    return null;
  }

  return children;
};

const PublicLayout = () => {
  const { status } = useAuthState();

  return (
    <>
      <Header variant={status === "unauthenticated" ? "public" : "brand"} />
      <main className="pb-8">
        <Outlet />
      </main>
    </>
  );
};

const RootLayout = () => (
  <div className="min-h-screen bg-brand-cream text-brand-ink">
    <Outlet />
  </div>
);

const rootRoute = createRootRoute({
  component: RootLayout,
});

const publicLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_public",
  component: PublicLayout,
});

const protectedLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_protected",
  component: ProtectedLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
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
  getParentRoute: () => protectedLayoutRoute,
  path: "/recipes",
  component: RecipesIndexRoute,
  errorComponent: RouteChunkError,
  pendingComponent: RecipeListSkeleton,
  pendingMs: 0,
});

const newRecipeRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/recipes/new",
  component: NewRecipeRoute,
  errorComponent: RouteChunkError,
  pendingComponent: RecipeFormSkeleton,
  pendingMs: 0,
});

const recipeDetailRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/recipes/$recipeId",
  component: RecipeDetailRoute,
  errorComponent: RouteChunkError,
  pendingComponent: RecipeDetailSkeleton,
  pendingMs: 0,
});

const editRecipeRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/recipes/$recipeId/edit",
  component: EditRecipeRoute,
  errorComponent: RouteChunkError,
  pendingComponent: RecipeFormSkeleton,
  pendingMs: 0,
});

type LoginSearch = {
  redirect?: string;
};

const loginRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: "/login",
  validateSearch: (search): LoginSearch => ({
    redirect: stringSearchParam(search.redirect),
  }),
  component: () => {
    const search = loginRoute.useSearch();
    const redirectTo = resolveAuthRedirect(search.redirect);

    return (
      <RedirectAuthenticated redirectTo={redirectTo}>
        <LoginRoute redirectTo={redirectTo} />
      </RedirectAuthenticated>
    );
  },
  errorComponent: RouteChunkError,
  pendingComponent: () => <LoadingStatus label="ログイン画面を読み込み中" />,
  pendingMs: 0,
});

const stringSearchParam = (value: unknown) => (typeof value === "string" ? value : undefined);

const importUrlRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/import/url",
  validateSearch: (search): ImportUrlSearch => ({
    text: stringSearchParam(search.text),
    title: stringSearchParam(search.title),
    url: stringSearchParam(search.url),
  }),
  component: () => {
    const search = importUrlRoute.useSearch();

    return <ImportUrlRoute key={JSON.stringify([search.url, search.text])} search={search} />;
  },
  errorComponent: RouteChunkError,
  pendingComponent: ImportUrlSkeleton,
  pendingMs: 0,
});

const settingsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/settings",
  component: SettingsIndexRoute,
  errorComponent: RouteChunkError,
  pendingComponent: SettingsSkeleton,
  pendingMs: 0,
});

const settingsBillingRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/settings/billing",
  component: SettingsBillingRoute,
  errorComponent: RouteChunkError,
  pendingComponent: SettingsSkeleton,
  pendingMs: 0,
});

const routeTree = rootRoute.addChildren([
  publicLayoutRoute.addChildren([indexRoute, loginRoute]),
  protectedLayoutRoute.addChildren([
    recipesRoute,
    newRecipeRoute,
    recipeDetailRoute,
    editRecipeRoute,
    importUrlRoute,
    settingsRoute,
    settingsBillingRoute,
  ]),
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
  <AuthStateProvider>
    <RouterProvider router={appRouter} />
  </AuthStateProvider>
);

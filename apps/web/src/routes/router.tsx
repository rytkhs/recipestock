import { MAX_RECIPE_TAGS, recipeListSortSchema } from "@recipestock/schemas";
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  RouterProvider,
  stripSearchParams,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { z } from "zod";
import { ConnectionUnavailable } from "../components/connection-unavailable";
import { Header, MobileAddRecipeFab } from "../components/header";
import {
  ImportTextSkeleton,
  ImportUrlSkeleton,
  LoadingStatus,
  RecipeDetailSkeleton,
  RecipeFormSkeleton,
  RecipeListSkeleton,
  SettingsPageSkeleton,
  SettingsSkeleton,
} from "../components/loading";
import { RouteChunkError } from "../components/route-chunk-error";
import { readRecipeListSort } from "../features/recipes/list-search";
import { AuthStateProvider, useAuthState } from "../lib/auth-state";
import { useProtectedAccess } from "../lib/protected-access";
import { isProtectedAppPath, resolveAuthRedirect } from "../lib/route-access";
import { type ImportUrlSearch } from "./import";
import { type ImportTextSearch } from "./import-text";

const LoginScreen = lazyRouteComponent(() => import("./login"), "LoginRoute");
const ImportUrlScreen = lazyRouteComponent(() => import("./import"), "ImportUrlRoute");
const ImportTextScreen = lazyRouteComponent(() => import("./import-text"), "ImportTextRoute");
const RecipesIndexRoute = lazyRouteComponent(() => import("./recipes-index"), "RecipesIndexRoute");
const NewRecipeRoute = lazyRouteComponent(() => import("./recipe-editor"), "NewRecipeRoute");
const EditRecipeRoute = lazyRouteComponent(() => import("./recipe-editor"), "EditRecipeRoute");
const RecipeDetailRoute = lazyRouteComponent(() => import("./recipe-detail"), "RecipeDetailRoute");
const TagsRoute = lazyRouteComponent(() => import("./tags"), "TagsRoute");
const SettingsIndexRoute = lazyRouteComponent(
  () => import("./settings-index"),
  "SettingsIndexRoute",
);
const SettingsBillingRoute = lazyRouteComponent(
  () => import("./settings-billing"),
  "SettingsBillingRoute",
);
const SettingsShareRoute = lazyRouteComponent(
  () => import("./settings-share"),
  "SettingsShareRoute",
);
const SettingsEmailRoute = lazyRouteComponent(
  () => import("./settings-email"),
  "SettingsEmailRoute",
);
const SettingsPasswordRoute = lazyRouteComponent(
  () => import("./settings-password"),
  "SettingsPasswordRoute",
);

const withPreload = <TProps,>(
  component: (props: TProps) => ReactNode,
  preload: (() => Promise<unknown>) | undefined,
) => Object.assign(component, { preload });

const LoginRoute = withPreload(
  ({ redirectTo, startAtPasswordReset }: { redirectTo: string; startAtPasswordReset: boolean }) => (
    <LoginScreen redirectTo={redirectTo} startAtPasswordReset={startAtPasswordReset} />
  ),
  LoginScreen.preload,
);
const ImportUrlRoute = withPreload(
  ({ search }: { search: ImportUrlSearch }) => <ImportUrlScreen search={search} />,
  ImportUrlScreen.preload,
);
const ImportTextRoute = withPreload(
  ({ search }: { search: ImportTextSearch }) => <ImportTextScreen search={search} />,
  ImportTextScreen.preload,
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

  if (pathname === "/import/text") {
    return <ImportTextSkeleton />;
  }

  if (pathname === "/tags") {
    return <LoadingStatus label="タグを読み込み中" />;
  }

  if (pathname === "/settings") {
    return <SettingsSkeleton />;
  }

  if (pathname.startsWith("/settings/")) {
    return <SettingsPageSkeleton />;
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
  <div className="min-h-screen bg-background text-foreground">
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

const recipesSearchSchema = z.object({
  // 既定の新しい順はURLに載せない。読めない値はエラーにせず新しい順に戻す。
  // 未指定には既定値を埋めず、遷移先で並び順を指定したかを下のmiddlewareで見分ける。
  sort: recipeListSortSchema.optional().catch("newest"),
  // URLの読み取りは値をJSONとして読むので、数字だけの検索語は数値で届く。文字列に戻して受け、空は載せない。
  q: z
    .union([z.string(), z.number(), z.boolean()])
    .transform((value) => String(value).trim() || undefined)
    .optional()
    .catch(undefined),
  // 絞り込むタグのid。重複は除き、空なら載せない。読めない値は絞り込みなしに戻す。
  tags: z
    .array(z.string().min(1))
    .max(MAX_RECIPE_TAGS)
    .transform((tagIds) => (tagIds.length > 0 ? [...new Set(tagIds)] : undefined))
    .optional()
    .catch(undefined),
  untagged: z.literal(true).optional().catch(undefined),
});

const recipesRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/recipes",
  validateSearch: recipesSearchSchema,
  search: {
    middlewares: [
      stripSearchParams({ sort: "newest" }),
      // 並び順を指定せずに一覧へ移るときは、一覧で最後に使った並び順を引き継ぐ。
      // 絞り込み条件はここでは埋めず、戻る操作だけがsearchで渡す（ADR 0021）。
      // stripSearchParamsより内側に置き、指定された新しい順が消される前に判定する。
      ({ search, next }) => {
        const result = next(search);
        return { ...result, sort: result.sort ?? readRecipeListSort() };
      },
    ],
  },
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
  // 設定のパスワードのページからログアウトして再設定へ進むときに付く。読めない値は指定なしに戻す。
  mode?: "reset";
  redirect?: string;
};

const loginRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: "/login",
  validateSearch: (search): LoginSearch => ({
    mode: search.mode === "reset" ? "reset" : undefined,
    redirect: stringSearchParam(search.redirect),
  }),
  component: () => {
    const search = loginRoute.useSearch();
    const redirectTo = resolveAuthRedirect(search.redirect);

    return (
      <RedirectAuthenticated redirectTo={redirectTo}>
        <LoginRoute redirectTo={redirectTo} startAtPasswordReset={search.mode === "reset"} />
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

const importTextRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/import/text",
  validateSearch: (search): ImportTextSearch => ({
    fromJob: stringSearchParam(search.fromJob),
  }),
  component: () => {
    const search = importTextRoute.useSearch();

    return <ImportTextRoute key={search.fromJob ?? ""} search={search} />;
  },
  errorComponent: RouteChunkError,
  pendingComponent: ImportTextSkeleton,
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

// プランのページを開いた理由。ページは一度だけ読んでURLから消す。読めない値は理由なしとして扱う。
const settingsBillingSearchSchema = z.object({
  // Stripeの決済画面から戻ったときの結果（apps/api/src/routes/billing.ts）。
  checkout: z.enum(["success", "cancel"]).optional().catch(undefined),
  // ショートカットが上限で止まったときに開くURLの理由（apps/api/src/ios-share-notices.ts）。
  upsell: z.enum(["recipe_limit", "ai_usage_limit"]).optional().catch(undefined),
  from: z.literal("shortcut").optional().catch(undefined),
});

const settingsBillingRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/settings/billing",
  validateSearch: settingsBillingSearchSchema,
  component: SettingsBillingRoute,
  errorComponent: RouteChunkError,
  pendingComponent: SettingsPageSkeleton,
  pendingMs: 0,
});

const settingsShareRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/settings/share",
  component: SettingsShareRoute,
  errorComponent: RouteChunkError,
  pendingComponent: SettingsPageSkeleton,
  pendingMs: 0,
});

// 確認メールのリンクから戻ったときの結果（lib/auth.tsのchangeEmail）。ページは一度だけ読んでURLから消す。
const settingsEmailSearchSchema = z.object({
  from: z.literal("verify-link").optional().catch(undefined),
  // リンクを開けなかったときに、better-authが足すエラーコード。
  error: z.string().optional().catch(undefined),
});

const settingsEmailRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/settings/email",
  validateSearch: settingsEmailSearchSchema,
  component: SettingsEmailRoute,
  errorComponent: RouteChunkError,
  pendingComponent: SettingsPageSkeleton,
  pendingMs: 0,
});

const settingsPasswordRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/settings/password",
  component: SettingsPasswordRoute,
  errorComponent: RouteChunkError,
  pendingComponent: SettingsPageSkeleton,
  pendingMs: 0,
});

const tagsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: "/tags",
  component: TagsRoute,
  errorComponent: RouteChunkError,
  pendingComponent: () => <LoadingStatus label="タグを読み込み中" />,
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
    importTextRoute,
    tagsRoute,
    settingsRoute,
    settingsBillingRoute,
    settingsShareRoute,
    settingsEmailRoute,
    settingsPasswordRoute,
  ]),
]);

type AppRouterOptions = Omit<Parameters<typeof createRouter>[0], "routeTree">;

// 戻る・進むでは、その画面を離れたときのスクロール位置に戻す。
export const createAppRouter = (options?: AppRouterOptions) =>
  createRouter({ routeTree, scrollRestoration: true, ...options });

const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }

  interface HistoryState {
    /** 一覧から開いた詳細の履歴に付ける。詳細の戻るで、履歴を戻って一覧の位置に帰すため。 */
    openedFromRecipeList?: true;
  }
}

export const AppRouter = ({ appRouter = router }: { appRouter?: typeof router }) => (
  <AuthStateProvider>
    <RouterProvider router={appRouter} />
  </AuthStateProvider>
);

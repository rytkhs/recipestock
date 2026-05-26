import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { LoginRoute } from "./login";
import { NewRecipeRoute, RecipeDetailRoute, RecipesIndexRoute } from "./recipes";

const rootRoute = createRootRoute({
  component: () => (
    <div className="app-shell">
      <header className="top-bar">
        <Link to="/" className="brand">
          Recipe Stock
        </Link>
        <nav aria-label="Main navigation">
          <Link to="/recipes">Recipes</Link>
          <Link to="/import">Import</Link>
          <Link to="/settings">Settings</Link>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => (
    <section className="page">
      <h1>Recipe Stock</h1>
      <p>Import, confirm, save, search, and view recipes from one workspace.</p>
    </section>
  ),
});

const recipesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recipes",
  component: RecipesIndexRoute,
});

const newRecipeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recipes/new",
  component: NewRecipeRoute,
});

const recipeDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recipes/$recipeId",
  component: RecipeDetailRoute,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginRoute,
});

const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/import",
  component: () => (
    <section className="page">
      <h1>Import</h1>
    </section>
  ),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: () => (
    <section className="page">
      <h1>Settings</h1>
    </section>
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

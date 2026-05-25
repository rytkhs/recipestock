import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { LoginRoute } from "./login";

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
  component: () => (
    <section className="page">
      <h1>Recipes</h1>
    </section>
  ),
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
  importRoute,
  settingsRoute,
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export const AppRouter = () => <RouterProvider router={router} />;

export const isProtectedAppPath = (pathname: string) =>
  pathname === "/recipes" ||
  pathname.startsWith("/recipes/") ||
  pathname === "/import/url" ||
  pathname === "/settings" ||
  pathname.startsWith("/settings/");

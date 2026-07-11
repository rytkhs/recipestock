export const isProtectedAppPath = (pathname: string) =>
  pathname === "/recipes" ||
  pathname.startsWith("/recipes/") ||
  pathname === "/import/url" ||
  pathname === "/settings" ||
  pathname.startsWith("/settings/");

const DEFAULT_AUTH_REDIRECT = "/recipes";

export const resolveAuthRedirect = (value: unknown) => {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_AUTH_REDIRECT;
  }

  const url = new URL(value, "https://recipestock.invalid");

  if (!isProtectedAppPath(url.pathname)) {
    return DEFAULT_AUTH_REDIRECT;
  }

  return `${url.pathname}${url.search}${url.hash}`;
};

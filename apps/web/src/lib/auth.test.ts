import { describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: null, error: null })),
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({ getSession }),
}));

vi.mock("better-auth/client/plugins", () => ({
  emailOTPClient: () => ({}),
}));

describe("session checks", () => {
  it("availability回復ではcookie cacheを使ってsessionを確認する", async () => {
    const { getAuthSession } = await import("./auth");

    await getAuthSession();

    expect(getSession).toHaveBeenCalledWith();
  });

  // 401回復はsessionがまだ生きているかをDBに問う経路。server側のcookie cacheから
  // 答えると必ずauthenticatedが返り、回復が空回りしてexhaustedに落ちる。
  it("cookie cacheを迂回してsessionを確認する", async () => {
    const { getFreshAuthSession } = await import("./auth");

    await getFreshAuthSession();

    expect(getSession).toHaveBeenCalledWith({ query: { disableCookieCache: true } });
  });
});

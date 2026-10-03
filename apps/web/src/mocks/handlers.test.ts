import { getResponse } from "msw";
import { afterEach, expect, it, vi } from "vitest";
import { createHandlers } from "./handlers";
import { findScenario } from "./scenarios";

afterEach(() => vi.restoreAllMocks());

it("ハンドラのないAPIは実APIに流さず501で止める", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const handlers = createHandlers(findScenario("default").build(), { delayMs: 0 });
  const response = await getResponse(
    handlers,
    new Request(new URL("/api/not-mocked", window.location.origin)),
  );

  expect(response?.status).toBe(501);
});

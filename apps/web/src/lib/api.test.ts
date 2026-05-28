import { type ClientResponse } from "hono/client";
import { describe, expect, it } from "vitest";
import { ApiClientError, parseApiResponse } from "./api";

const clientResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  }) as unknown as ClientResponse<unknown>;

describe("parseApiResponse", () => {
  it("成功レスポンスのbodyを返す", async () => {
    await expect(
      parseApiResponse<{ ok: true }>(Promise.resolve(clientResponse({ ok: true }))),
    ).resolves.toEqual({ ok: true });
  });

  it("API error responseをApiClientErrorとして投げる", async () => {
    const promise = parseApiResponse(
      Promise.resolve(
        clientResponse(
          {
            error: {
              code: "recipe_limit_exceeded",
              message: "Recipe limit exceeded.",
            },
          },
          { status: 403 },
        ),
      ),
    );

    await expect(promise).rejects.toMatchObject({
      name: "ApiClientError",
      status: 403,
      code: "recipe_limit_exceeded",
      message: "Recipe limit exceeded.",
    });
    await expect(promise).rejects.toBeInstanceOf(ApiClientError);
  });

  it("不正なerror bodyはunexpected_responseとして投げる", async () => {
    await expect(
      parseApiResponse(Promise.resolve(clientResponse({ error: "broken" }, { status: 500 }))),
    ).rejects.toMatchObject({
      name: "ApiClientError",
      status: 500,
      code: "unexpected_response",
      message: "Unexpected API error response.",
    });
  });
});

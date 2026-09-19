import { describe, expect, it } from "vitest";
import { type TagRepository } from "../tags";
import { createSilentTestApp, createTestAuth, sameOriginHeaders } from "../test-helpers";

const createTagRepositoryStub = (overrides: Partial<TagRepository> = {}): TagRepository => ({
  listTags: async () => {
    throw new Error("should not list tags");
  },
  replaceRecipeTags: async () => {
    throw new Error("should not replace recipe tags");
  },
  renameTag: async () => {
    throw new Error("should not rename a tag");
  },
  mergeTag: async () => {
    throw new Error("should not merge tags");
  },
  deleteTag: async () => {
    throw new Error("should not delete a tag");
  },
  ...overrides,
});

const jsonRequest = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const env = { APP_ENV: "development" };

describe("Tag routes", () => {
  it("未ログインではタグ一覧を返さない", async () => {
    const testApp = createSilentTestApp({
      auth: createTestAuth(null),
      tagRepository: createTagRepositoryStub(),
    });

    const response = await testApp.request("/api/tags", undefined, env);

    expect(response.status).toBe(401);
  });

  it("自分のタグを件数付きで一覧する", async () => {
    const calls: string[] = [];
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      tagRepository: createTagRepositoryStub({
        listTags: async (userId) => {
          calls.push(userId);
          return [
            { id: "tag_1", name: "作り置き", recipeCount: 3 },
            { id: "tag_2", name: "お弁当", recipeCount: 0 },
          ];
        },
      }),
    });

    const response = await testApp.request("/api/tags", undefined, env);

    expect(response.status).toBe(200);
    expect(calls).toEqual(["user_123"]);
    await expect(response.json()).resolves.toEqual({
      tags: [
        { id: "tag_1", name: "作り置き", recipeCount: 3 },
        { id: "tag_2", name: "お弁当", recipeCount: 0 },
      ],
    });
  });

  it("名前を揃えてからタグ名を変更する", async () => {
    const calls: unknown[] = [];
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      tagRepository: createTagRepositoryStub({
        renameTag: async (params) => {
          calls.push(params);
          return { status: "renamed", tag: { id: params.tagId, name: params.name.name } };
        },
      }),
    });

    const response = await testApp.request(
      "/api/tags/tag_1",
      jsonRequest("PATCH", { name: " ＃ＢＢＱ " }),
      env,
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        userId: "user_123",
        tagId: "tag_1",
        name: { name: "BBQ", normalizedName: "bbq" },
        now: expect.any(Date),
      },
    ]);
    await expect(response.json()).resolves.toEqual({ tag: { id: "tag_1", name: "BBQ" } });
  });

  it("変更先の名前を別のタグが使っていればtag_name_conflictでそのタグを返す", async () => {
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      tagRepository: createTagRepositoryStub({
        renameTag: async () => ({ status: "conflict", tag: { id: "tag_2", name: "鶏肉" } }),
      }),
    });

    const response = await testApp.request(
      "/api/tags/tag_1",
      jsonRequest("PATCH", { name: "鶏肉" }),
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "tag_name_conflict",
        message: "Tag name is already used.",
        details: { tag: { id: "tag_2", name: "鶏肉" } },
      },
    });
  });

  it("揃えると空になる名前や長すぎる名前には変更しない", async () => {
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      tagRepository: createTagRepositoryStub(),
    });

    for (const name of [" # ", "あ".repeat(21)]) {
      const response = await testApp.request(
        "/api/tags/tag_1",
        jsonRequest("PATCH", { name }),
        env,
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "validation_failed" },
      });
    }
  });

  it("存在しないタグの名前は変更できない", async () => {
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      tagRepository: createTagRepositoryStub({
        renameTag: async () => ({ status: "notFound" }),
      }),
    });

    const response = await testApp.request(
      "/api/tags/missing",
      jsonRequest("PATCH", { name: "鶏肉" }),
      env,
    );

    expect(response.status).toBe(404);
  });

  it("タグを別のタグへ統合し、統合先を返す", async () => {
    const calls: unknown[] = [];
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      tagRepository: createTagRepositoryStub({
        mergeTag: async (params) => {
          calls.push(params);
          return { status: "merged", tag: { id: "tag_2", name: "鶏肉" } };
        },
      }),
    });

    const response = await testApp.request(
      "/api/tags/tag_1/merge",
      jsonRequest("POST", { intoTagId: "tag_2" }),
      env,
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([{ userId: "user_123", tagId: "tag_1", intoTagId: "tag_2" }]);
    await expect(response.json()).resolves.toEqual({ tag: { id: "tag_2", name: "鶏肉" } });
  });

  it("タグを自分自身へは統合できない", async () => {
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      tagRepository: createTagRepositoryStub(),
    });

    const response = await testApp.request(
      "/api/tags/tag_1/merge",
      jsonRequest("POST", { intoTagId: "tag_1" }),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_failed" },
    });
  });

  it("統合元か統合先のタグがなければnot_foundを返す", async () => {
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      tagRepository: createTagRepositoryStub({
        mergeTag: async () => ({ status: "notFound" }),
      }),
    });

    const response = await testApp.request(
      "/api/tags/tag_1/merge",
      jsonRequest("POST", { intoTagId: "missing" }),
      env,
    );

    expect(response.status).toBe(404);
  });

  it("タグを削除し、存在しないタグはnot_foundを返す", async () => {
    const deleted: string[] = [];
    const testApp = createSilentTestApp({
      auth: createTestAuth(),
      tagRepository: createTagRepositoryStub({
        deleteTag: async (userId, tagId) => {
          deleted.push(`${userId}:${tagId}`);
          return tagId === "tag_1";
        },
      }),
    });

    // 本文のないDELETEはCSRF対策でフォーム送信と同じ扱いになるので、同一オリジンからの要求にする。
    const deleteRequest = { method: "DELETE", headers: sameOriginHeaders };
    const response = await testApp.request("/api/tags/tag_1", deleteRequest, env);
    const missingResponse = await testApp.request("/api/tags/missing", deleteRequest, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(missingResponse.status).toBe(404);
    expect(deleted).toEqual(["user_123:tag_1", "user_123:missing"]);
  });
});

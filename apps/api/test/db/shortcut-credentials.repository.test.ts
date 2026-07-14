import { neonConfig } from "@neondatabase/serverless";
import { createDb } from "@recipestock/db";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createShortcutCredentialRepository,
  type ShortcutCredentialRepository,
} from "../../src/shortcut-credentials";

const now = new Date("2026-07-12T00:00:00.000Z");

describe("Shortcut credential repository with Neon Postgres", () => {
  let repository: ShortcutCredentialRepository;

  beforeAll(() => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests.");
    }
    const connectionUrl = new URL(databaseUrl);
    neonConfig.fetchEndpoint = `http://${connectionUrl.hostname}:${connectionUrl.port}/sql`;
    neonConfig.poolQueryViaFetch = true;
    neonConfig.useSecureWebSocket = false;
    repository = createShortcutCredentialRepository(createDb(databaseUrl));
  });

  it("発行、認証時の最終利用日時更新、revokeを永続化する", async () => {
    const runId = crypto.randomUUID();
    const credentialId = `dbtest_credential_${runId}`;
    const userId = `dbtest_user_${runId}`;
    const tokenHash = `dbtest_token_${runId}`;
    await repository.createCredential({
      id: credentialId,
      userId,
      name: "DB test credential",
      tokenHash,
      tokenSuffix: runId.slice(-6),
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    });

    const usedAt = new Date(now.getTime() + 1000);
    await expect(repository.authenticate({ tokenHash, now: usedAt })).resolves.toEqual({
      credentialId,
      userId,
    });
    await expect(repository.listCredentials(userId)).resolves.toEqual([
      expect.objectContaining({ id: credentialId, lastUsedAt: usedAt }),
    ]);

    await expect(
      repository.revokeCredential({ credentialId, userId, now: new Date(usedAt.getTime() + 1) }),
    ).resolves.toBe(true);
    await expect(repository.authenticate({ tokenHash, now: usedAt })).resolves.toBeNull();
    await expect(repository.listCredentials(userId)).resolves.toEqual([]);
  });
});

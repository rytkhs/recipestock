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

  it("発行、認証、revokeを永続化する", async () => {
    const runId = crypto.randomUUID();
    const credentialId = `dbtest_credential_${runId}`;
    const userId = `dbtest_user_${runId}`;
    const tokenHash = `dbtest_token_${runId}`;
    await repository.createCredential({
      id: credentialId,
      userId,
      name: null,
      tokenHash,
      tokenSuffix: runId.slice(-6),
      createdAt: now,
      verifiedAt: null,
      revokedAt: null,
    });

    await expect(repository.authenticate({ tokenHash })).resolves.toEqual({
      credentialId,
      userId,
      verified: false,
    });
    await expect(repository.listCredentials(userId)).resolves.toEqual([
      expect.objectContaining({ id: credentialId, name: null, verifiedAt: null }),
    ]);

    await expect(
      repository.revokeCredential({
        credentialId,
        userId,
        now: new Date(now.getTime() + 1000),
      }),
    ).resolves.toBe(true);
    await expect(repository.authenticate({ tokenHash })).resolves.toBeNull();
    await expect(repository.listCredentials(userId)).resolves.toEqual([]);
  });

  /**
   * 書き込みは初回の1回だけにする。`verified_at is null`の条件で、2回目以降は
   * 端末名も連携日時も上書きしない (ADR 0025)。
   */
  it("連携の確定を初回の1回だけ書き込む", async () => {
    const runId = crypto.randomUUID();
    const credentialId = `dbtest_credential_${runId}`;
    const userId = `dbtest_user_${runId}`;
    const tokenHash = `dbtest_token_${runId}`;
    const verifiedAt = new Date(now.getTime() + 60_000);
    await repository.createCredential({
      id: credentialId,
      userId,
      name: null,
      tokenHash,
      tokenSuffix: runId.slice(-6),
      createdAt: now,
      verifiedAt: null,
      revokedAt: null,
    });

    await repository.markVerified({ credentialId, name: "たかしのiPhone", now: verifiedAt });

    await expect(repository.authenticate({ tokenHash })).resolves.toEqual({
      credentialId,
      userId,
      verified: true,
    });
    await expect(repository.listCredentials(userId)).resolves.toEqual([
      expect.objectContaining({ name: "たかしのiPhone", verifiedAt }),
    ]);

    await repository.markVerified({
      credentialId,
      name: "別のiPad",
      now: new Date(now.getTime() + 120_000),
    });

    await expect(repository.listCredentials(userId)).resolves.toEqual([
      expect.objectContaining({ name: "たかしのiPhone", verifiedAt }),
    ]);
  });
});

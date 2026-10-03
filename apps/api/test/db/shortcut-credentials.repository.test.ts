import { neonConfig } from "@neondatabase/serverless";
import { createDb, shortcutCredentials } from "@recipestock/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createShortcutCredentialRepository,
  type ShortcutCredentialRepository,
} from "../../src/shortcut-credentials";

const now = new Date("2026-07-12T00:00:00.000Z");
const firstUse = new Date("2026-07-12T00:05:00.000Z");
const laterUse = new Date("2026-07-13T08:00:00.000Z");

describe("Shortcut credential repository with Neon Postgres", () => {
  let repository: ShortcutCredentialRepository;
  let db: ReturnType<typeof createDb>;

  beforeAll(() => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests.");
    }
    const connectionUrl = new URL(databaseUrl);
    neonConfig.fetchEndpoint = `http://${connectionUrl.hostname}:${connectionUrl.port}/sql`;
    neonConfig.poolQueryViaFetch = true;
    neonConfig.useSecureWebSocket = false;
    db = createDb(databaseUrl);
    repository = createShortcutCredentialRepository(db);
  });

  const createCredential = async () => {
    const runId = crypto.randomUUID();
    const credential = {
      id: `dbtest_credential_${runId}`,
      userId: `dbtest_user_${runId}`,
      name: "DB test credential",
      tokenHash: `dbtest_token_${runId}`,
      tokenSuffix: runId.slice(-6),
      createdAt: now,
      firstUsedAt: null,
      lastUsedAt: null,
      revokedAt: null,
    };
    await repository.createCredential(credential);
    return credential;
  };

  it("発行、認証、revokeを永続化する", async () => {
    const { id: credentialId, userId, tokenHash } = await createCredential();

    await expect(repository.authenticate({ tokenHash, now: firstUse })).resolves.toEqual({
      status: "active",
      credentialId,
      userId,
    });
    await expect(repository.listCredentials(userId)).resolves.toEqual([
      expect.objectContaining({ id: credentialId }),
    ]);

    await expect(
      repository.revokeCredential({
        credentialId,
        userId,
        now: new Date(now.getTime() + 1000),
      }),
    ).resolves.toBe(true);
    await expect(repository.listCredentials(userId)).resolves.toEqual([]);
  });

  it("認証を通すたびに最後に使った時刻を進め、最初に使った時刻は残す", async () => {
    const { userId, tokenHash } = await createCredential();

    await expect(repository.listCredentials(userId)).resolves.toEqual([
      expect.objectContaining({ firstUsedAt: null, lastUsedAt: null }),
    ]);

    await repository.authenticate({ tokenHash, now: firstUse });
    await repository.authenticate({ tokenHash, now: laterUse });

    await expect(repository.listCredentials(userId)).resolves.toEqual([
      expect.objectContaining({ firstUsedAt: firstUse, lastUsedAt: laterUse }),
    ]);
  });

  it("解除したキーは使った時刻を進めず、知らないキーと分けて返す", async () => {
    const { id: credentialId, userId, tokenHash } = await createCredential();
    await repository.authenticate({ tokenHash, now: firstUse });
    await repository.revokeCredential({ credentialId, userId, now: firstUse });

    await expect(repository.authenticate({ tokenHash, now: laterUse })).resolves.toEqual({
      status: "revoked",
      credentialId,
      userId,
    });
    const [row] = await db
      .select({ lastUsedAt: shortcutCredentials.lastUsedAt })
      .from(shortcutCredentials)
      .where(eq(shortcutCredentials.id, credentialId));
    expect(row?.lastUsedAt).toEqual(firstUse);
    await expect(
      repository.authenticate({
        tokenHash: `dbtest_unknown_${crypto.randomUUID()}`,
        now: laterUse,
      }),
    ).resolves.toEqual({ status: "unknown" });
  });
});

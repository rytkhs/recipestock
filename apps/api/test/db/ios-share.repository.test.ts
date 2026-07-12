import { neonConfig } from "@neondatabase/serverless";
import { createDb } from "@recipestock/db";
import { beforeAll, describe, expect, it } from "vitest";
import { createIosShareRepository, type IosShareRepository } from "../../src/ios-share";

const now = new Date("2026-07-12T00:00:00.000Z");

describe("iOS Share repository with Neon Postgres", () => {
  let repository: IosShareRepository;

  beforeAll(() => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests.");
    }
    const connectionUrl = new URL(databaseUrl);
    neonConfig.fetchEndpoint = `http://${connectionUrl.hostname}:${connectionUrl.port}/sql`;
    neonConfig.poolQueryViaFetch = true;
    neonConfig.useSecureWebSocket = false;
    repository = createIosShareRepository(createDb(databaseUrl));
  });

  it("同じchannelの未配送handoffを新しいhandoffで置き換える", async () => {
    const runId = crypto.randomUUID();
    const channelId = `dbtest_channel_${runId}`;
    const userId = `dbtest_user_${runId}`;
    const tokenHash = `dbtest_token_${runId}`;
    const firstId = `dbtest_handoff_first_${runId}`;
    const secondId = `dbtest_handoff_second_${runId}`;

    await repository.createChannel({
      id: channelId,
      userId,
      name: "DB test channel",
      tokenHash,
      tokenSuffix: runId.slice(-6),
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    });

    await expect(
      repository.submitHandoff({
        id: firstId,
        tokenHash,
        url: "https://example.com/first",
        now,
        expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ id: firstId, supersededAt: null });

    const secondNow = new Date(now.getTime() + 1000);
    await expect(
      repository.submitHandoff({
        id: secondId,
        tokenHash,
        url: "https://example.com/second",
        now: secondNow,
        expiresAt: new Date(secondNow.getTime() + 30 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ id: secondId, supersededAt: null });

    await expect(
      repository.inspectHandoff({ handoffId: firstId, tokenHash }),
    ).resolves.toMatchObject({
      id: firstId,
      supersededAt: secondNow,
    });
    await expect(repository.findPendingHandoff({ userId, now: secondNow })).resolves.toMatchObject({
      id: secondId,
    });
  });

  it("同じchannelへの同時submitをどちらも受け付ける", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_concurrent_user_${runId}`;
    const tokenHash = `dbtest_concurrent_token_${runId}`;
    const handoffIds = [
      `dbtest_concurrent_handoff_a_${runId}`,
      `dbtest_concurrent_handoff_b_${runId}`,
    ];

    await repository.createChannel({
      id: `dbtest_concurrent_channel_${runId}`,
      userId,
      name: "Concurrent DB test channel",
      tokenHash,
      tokenSuffix: runId.slice(-6),
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    });

    const results = await Promise.all(
      handoffIds.map((id, index) =>
        repository.submitHandoff({
          id,
          tokenHash,
          url: `https://example.com/concurrent/${index}`,
          now: new Date(now.getTime() + index),
          expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        }),
      ),
    );

    expect(results).toEqual([
      expect.objectContaining({ id: handoffIds[0] }),
      expect.objectContaining({ id: handoffIds[1] }),
    ]);
    await expect(repository.findPendingHandoff({ userId, now })).resolves.toEqual(
      expect.objectContaining({ id: expect.stringMatching(/^dbtest_concurrent_handoff_[ab]_/) }),
    );
  });
});

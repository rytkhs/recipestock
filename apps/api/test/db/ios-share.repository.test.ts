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

  it("異なるchannelの未配送handoffも同じuserの新しいhandoffで置き換える", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_cross_channel_user_${runId}`;
    const firstChannelId = `dbtest_cross_channel_first_${runId}`;
    const secondChannelId = `dbtest_cross_channel_second_${runId}`;
    const firstTokenHash = `dbtest_cross_channel_token_first_${runId}`;
    const secondTokenHash = `dbtest_cross_channel_token_second_${runId}`;
    const firstId = `dbtest_cross_channel_handoff_first_${runId}`;
    const secondId = `dbtest_cross_channel_handoff_second_${runId}`;

    await repository.createChannel({
      id: firstChannelId,
      userId,
      name: "First cross-channel test channel",
      tokenHash: firstTokenHash,
      tokenSuffix: runId.slice(-6),
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    });
    await repository.createChannel({
      id: secondChannelId,
      userId,
      name: "Second cross-channel test channel",
      tokenHash: secondTokenHash,
      tokenSuffix: runId.slice(-6),
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    });

    await repository.submitHandoff({
      id: firstId,
      tokenHash: firstTokenHash,
      url: "https://example.com/cross-channel-first",
      now,
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    });

    const secondNow = new Date(now.getTime() + 1000);
    await repository.submitHandoff({
      id: secondId,
      tokenHash: secondTokenHash,
      url: "https://example.com/cross-channel-second",
      now: secondNow,
      expiresAt: new Date(secondNow.getTime() + 30 * 60 * 1000),
    });

    await expect(
      repository.inspectHandoff({ handoffId: firstId, tokenHash: firstTokenHash }),
    ).resolves.toMatchObject({ supersededAt: secondNow });

    await repository.deliverHandoff({
      handoffId: secondId,
      userId,
      target: "pwa",
      now: new Date(secondNow.getTime() + 1000),
    });

    await expect(
      repository.findPendingHandoff({ userId, now: new Date(secondNow.getTime() + 1000) }),
    ).resolves.toBeNull();
  });

  it("異なるchannelへの同時submitも同じuserにpendingを一件だけ残す", async () => {
    const runId = crypto.randomUUID();
    const userId = `dbtest_concurrent_cross_channel_user_${runId}`;
    const channelIds = [
      `dbtest_concurrent_cross_channel_a_${runId}`,
      `dbtest_concurrent_cross_channel_b_${runId}`,
    ];
    const tokenHashes = [
      `dbtest_concurrent_cross_channel_token_a_${runId}`,
      `dbtest_concurrent_cross_channel_token_b_${runId}`,
    ];
    const handoffIds = [
      `dbtest_concurrent_cross_channel_handoff_a_${runId}`,
      `dbtest_concurrent_cross_channel_handoff_b_${runId}`,
    ];

    await Promise.all(
      channelIds.map((channelId, index) =>
        repository.createChannel({
          id: channelId,
          userId,
          name: `Concurrent cross-channel test channel ${index}`,
          tokenHash: tokenHashes[index] as string,
          tokenSuffix: runId.slice(-6),
          createdAt: now,
          lastUsedAt: null,
          revokedAt: null,
        }),
      ),
    );

    await Promise.all(
      handoffIds.map((id, index) =>
        repository.submitHandoff({
          id,
          tokenHash: tokenHashes[index] as string,
          url: `https://example.com/concurrent-cross-channel/${index}`,
          now: new Date(now.getTime() + index),
          expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        }),
      ),
    );

    const handoffs = await Promise.all(
      handoffIds.map((handoffId, index) =>
        repository.inspectHandoff({ handoffId, tokenHash: tokenHashes[index] as string }),
      ),
    );
    expect(handoffs.filter((handoff) => handoff?.supersededAt === null)).toHaveLength(1);
    await expect(repository.findPendingHandoff({ userId, now })).resolves.toMatchObject({
      id: expect.stringMatching(/^dbtest_concurrent_cross_channel_handoff_[ab]_/),
    });
  });
});

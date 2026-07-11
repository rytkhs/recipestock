import { describe, expect, it } from "vitest";
import {
  createIosShareService,
  type IosShareChannelRecord,
  type IosShareHandoffRecord,
  type IosShareRepository,
  resolveIosShareHandoffStatus,
} from "./ios-share";

const now = new Date("2026-07-11T00:00:00.000Z");

const createRepository = () => {
  const channels: IosShareChannelRecord[] = [];
  const handoffs: IosShareHandoffRecord[] = [];
  const repository: IosShareRepository = {
    async createChannel(channel) {
      channels.push(channel);
      return channel;
    },
    async listChannels(userId) {
      return channels.filter((channel) => channel.userId === userId && !channel.revokedAt);
    },
    async revokeChannel({ channelId, userId, now: revokedAt }) {
      const channel = channels.find(
        (candidate) => candidate.id === channelId && candidate.userId === userId,
      );
      if (!channel) return false;
      channel.revokedAt = revokedAt;
      return true;
    },
    async submitHandoff({ id, tokenHash, url, now: createdAt, expiresAt }) {
      const channel = channels.find(
        (candidate) => candidate.tokenHash === tokenHash && !candidate.revokedAt,
      );
      if (!channel) return null;
      for (const handoff of handoffs) {
        if (handoff.channelId === channel.id && !handoff.deliveredAt && !handoff.supersededAt) {
          handoff.supersededAt = createdAt;
        }
      }
      const handoff: IosShareHandoffRecord = {
        id,
        channelId: channel.id,
        userId: channel.userId,
        url,
        deliveredTarget: null,
        deliveredAt: null,
        supersededAt: null,
        expiresAt,
        createdAt,
        updatedAt: createdAt,
      };
      handoffs.push(handoff);
      return handoff;
    },
    async findPendingHandoff({ userId, now: currentDate }) {
      return (
        handoffs
          .filter(
            (handoff) =>
              handoff.userId === userId &&
              !handoff.deliveredAt &&
              !handoff.supersededAt &&
              handoff.expiresAt > currentDate,
          )
          .at(-1) ?? null
      );
    },
    async deliverHandoff({ handoffId, userId, target, now: deliveredAt }) {
      const handoff = handoffs.find(
        (candidate) => candidate.id === handoffId && candidate.userId === userId,
      );
      if (!handoff) return null;
      if (!handoff.deliveredAt && !handoff.supersededAt && handoff.expiresAt > deliveredAt) {
        handoff.deliveredAt = deliveredAt;
        handoff.deliveredTarget = target;
      }
      return handoff;
    },
    async inspectHandoff({ handoffId, tokenHash }) {
      const channel = channels.find(
        (candidate) => candidate.tokenHash === tokenHash && !candidate.revokedAt,
      );
      return (
        handoffs.find((handoff) => handoff.id === handoffId && handoff.channelId === channel?.id) ??
        null
      );
    },
  };
  return { channels, handoffs, repository };
};

describe("iOS Share module", () => {
  it("平文tokenを返しDBにはhashだけを保存する", async () => {
    const state = createRepository();
    const service = createIosShareService(state.repository);
    const result = await service.provisionChannel({
      id: "channel_1",
      userId: "user_1",
      name: "iPhone",
      token: `rssc_${"a".repeat(64)}`,
      now,
    });

    expect(result.token).toBe(`rssc_${"a".repeat(64)}`);
    expect(state.channels[0]?.tokenHash).not.toContain("rssc_");
    expect(state.channels[0]?.tokenSuffix).toBe("aaaaaa");
  });

  it("新しいhandoffで同じchannelの古いpendingをsupersedeする", async () => {
    const state = createRepository();
    const service = createIosShareService(state.repository);
    const token = `rssc_${"b".repeat(64)}`;
    await service.provisionChannel({
      id: "channel_1",
      userId: "user_1",
      name: "iPhone",
      token,
      now,
    });
    await service.submitHandoff({
      id: "handoff_1",
      token,
      url: "https://example.com/one",
      origin: "https://app.example.com",
      now,
    });
    await service.submitHandoff({
      id: "handoff_2",
      token,
      url: "https://example.com/two",
      origin: "https://app.example.com",
      now: new Date(now.getTime() + 1000),
    });

    const firstHandoff = state.handoffs[0];
    expect(firstHandoff && resolveIosShareHandoffStatus(firstHandoff, now)).toBe("superseded");
    await expect(service.findPendingHandoff({ userId: "user_1", now })).resolves.toMatchObject({
      id: "handoff_2",
      url: "https://example.com/two",
    });
  });

  it("PWA deliveryをShortcut tokenから確認できる", async () => {
    const state = createRepository();
    const service = createIosShareService(state.repository);
    const token = `rssc_${"c".repeat(64)}`;
    await service.provisionChannel({
      id: "channel_1",
      userId: "user_1",
      name: "iPhone",
      token,
      now,
    });
    const submitted = await service.submitHandoff({
      id: "handoff_1",
      token,
      url: "https://example.com/recipe",
      origin: "https://app.example.com",
      now,
    });
    await service.deliverHandoff({
      handoffId: "handoff_1",
      userId: "user_1",
      target: "pwa",
      now,
    });

    expect(submitted?.fallbackUrl).toContain("/import/url?");
    await expect(service.inspectHandoff({ handoffId: "handoff_1", token, now })).resolves.toBe(
      "delivered_to_pwa",
    );
  });
});

import { shortcutCredentialTokenSchema } from "@recipestock/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  createShortcutCredentials,
  createShortcutCredentialToken,
  type ShortcutCredentialRecord,
  type ShortcutCredentialRepository,
} from "./shortcut-credentials";

const issuedAt = new Date("2026-07-11T00:00:00.000Z");
const _usedAt = new Date("2026-07-11T00:01:00.000Z");

const createRepository = () => {
  const records: ShortcutCredentialRecord[] = [];
  const repository: ShortcutCredentialRepository = {
    async createCredential(record) {
      records.push(record);
      return record;
    },
    async listCredentials(userId) {
      return records.filter((record) => record.userId === userId && !record.revokedAt);
    },
    async revokeCredential({ credentialId, userId, now }) {
      const record = records.find(
        (candidate) =>
          candidate.id === credentialId && candidate.userId === userId && !candidate.revokedAt,
      );
      if (!record) return false;
      record.revokedAt = now;
      return true;
    },
    async authenticate({ tokenHash, now }) {
      const record = records.find((candidate) => candidate.tokenHash === tokenHash);
      if (!record) return { status: "unknown" };
      if (record.revokedAt) {
        return { status: "revoked", credentialId: record.id, userId: record.userId };
      }
      record.firstUsedAt ??= now;
      record.lastUsedAt = now;
      return { status: "active", credentialId: record.id, userId: record.userId };
    },
  };
  return { records, repository };
};

describe("Shortcut credentials Module", () => {
  it("発行するtokenはschemaが受け付ける形で、毎回異なる", () => {
    const token = createShortcutCredentialToken();

    expect(shortcutCredentialTokenSchema.safeParse(token).success).toBe(true);
    expect(createShortcutCredentialToken()).not.toBe(token);
  });

  it("平文tokenを発行時だけ返し、repositoryにはhashとsuffixを保存する", async () => {
    const createCredential = vi.fn(async (record: ShortcutCredentialRecord) => record);
    const credentials = createShortcutCredentials({
      repository: {
        createCredential,
        listCredentials: async () => [],
        revokeCredential: async () => false,
        authenticate: async () => ({ status: "unknown" }),
      },
      createId: () => "credential_1",
      createToken: () => `rssc_${"a".repeat(25)}`,
      getCurrentDate: () => issuedAt,
    });

    await expect(credentials.issue({ userId: "user_1", name: "iPhone" })).resolves.toEqual({
      credential: {
        id: "credential_1",
        name: "iPhone",
        tokenSuffix: "aaaa",
        createdAt: issuedAt.toISOString(),
        firstUsedAt: null,
        lastUsedAt: null,
      },
      token: `rssc_${"a".repeat(25)}`,
    });
    expect(createCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        name: "iPhone",
        tokenSuffix: "aaaa",
        tokenHash: "b9829a68e15edfa2b3668c4062b9299d30c6a6c9362e904aa995ec39b65ace07",
      }),
    );
  });
});
describe("Shortcut credentials Module", () => {
  it("発行するtokenはschemaが受け付ける形で、毎回異なる", () => {
    const token = createShortcutCredentialToken();

    expect(shortcutCredentialTokenSchema.safeParse(token).success).toBe(true);
    expect(token).toHaveLength(30);
    expect(createShortcutCredentialToken()).not.toBe(token);
  });

  it("平文tokenを発行時だけ返し、repositoryにはhashとsuffixを保存する", async () => {
    const state = createRepository();
    const credentials = createShortcutCredentials({
      repository: state.repository,
      createId: () => "credential_1",
      createToken: () => `rssc_${"a".repeat(25)}`,
      getCurrentDate: () => issuedAt,
    });

    await expect(credentials.issue({ userId: "user_1", name: "iPhone" })).resolves.toEqual({
      credential: {
        id: "credential_1",
        name: "iPhone",
        tokenSuffix: "aaaa",
        createdAt: issuedAt.toISOString(),
        firstUsedAt: null,
        lastUsedAt: null,
      },
      token: `rssc_${"a".repeat(25)}`,
    });
    expect(state.records[0]?.tokenHash).not.toContain("rssc_");
    expect(state.records[0]?.tokenSuffix).toBe("aaaa");
  });
});

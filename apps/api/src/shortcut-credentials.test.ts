import { describe, expect, it } from "vitest";
import {
  createShortcutCredentials,
  type ShortcutCredentialRecord,
  type ShortcutCredentialRepository,
} from "./shortcut-credentials";

const issuedAt = new Date("2026-07-11T00:00:00.000Z");
const usedAt = new Date("2026-07-11T00:01:00.000Z");

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
    async authenticate({ tokenHash }) {
      const record = records.find(
        (candidate) => candidate.tokenHash === tokenHash && !candidate.revokedAt,
      );
      if (!record) return null;
      return { credentialId: record.id, userId: record.userId };
    },
  };
  return { records, repository };
};

describe("Shortcut credentials Module", () => {
  it("平文tokenを発行時だけ返し、repositoryにはhashとsuffixを保存する", async () => {
    const state = createRepository();
    const credentials = createShortcutCredentials({
      repository: state.repository,
      createId: () => "credential_1",
      createToken: () => `rssc_${"a".repeat(64)}`,
      getCurrentDate: () => issuedAt,
    });

    await expect(credentials.issue({ userId: "user_1", name: "iPhone" })).resolves.toEqual({
      credential: {
        id: "credential_1",
        name: "iPhone",
        tokenSuffix: "aaaaaa",
        createdAt: issuedAt.toISOString(),
      },
      token: `rssc_${"a".repeat(64)}`,
    });
    expect(state.records[0]?.tokenHash).not.toContain("rssc_");
    expect(state.records[0]?.tokenSuffix).toBe("aaaaaa");
  });

  it("認証成功時にcredentialId/userIdを返す", async () => {
    const state = createRepository();
    let currentDate = issuedAt;
    const token = `rssc_${"b".repeat(64)}`;
    const credentials = createShortcutCredentials({
      repository: state.repository,
      createId: () => "credential_1",
      createToken: () => token,
      getCurrentDate: () => currentDate,
    });
    await credentials.issue({ userId: "user_1", name: "iPhone" });

    currentDate = usedAt;
    await expect(credentials.authenticate({ token })).resolves.toEqual({
      credentialId: "credential_1",
      userId: "user_1",
    });
  });

  it("一覧はactive credentialだけを返し、revoke後のtokenを拒否する", async () => {
    const state = createRepository();
    let currentDate = issuedAt;
    const token = `rssc_${"c".repeat(64)}`;
    const credentials = createShortcutCredentials({
      repository: state.repository,
      createId: () => "credential_1",
      createToken: () => token,
      getCurrentDate: () => currentDate,
    });
    await credentials.issue({ userId: "user_1", name: "iPhone" });

    await expect(credentials.list("user_1")).resolves.toHaveLength(1);
    currentDate = usedAt;
    await expect(
      credentials.revoke({ credentialId: "credential_1", userId: "user_1" }),
    ).resolves.toBe(true);
    await expect(credentials.list("user_1")).resolves.toEqual([]);
    await expect(credentials.authenticate({ token })).resolves.toBeNull();
  });
});

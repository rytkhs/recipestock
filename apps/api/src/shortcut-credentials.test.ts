import { shortcutCredentialTokenSchema } from "@recipestock/schemas";
import { describe, expect, it } from "vitest";
import {
  createShortcutCredentials,
  createShortcutCredentialToken,
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
    async markVerified({ credentialId, name, now }) {
      const record = records.find(
        (candidate) => candidate.id === credentialId && !candidate.verifiedAt,
      );
      if (!record) return;
      record.verifiedAt = now;
      record.name = name;
    },
    async authenticate({ tokenHash }) {
      const record = records.find(
        (candidate) => candidate.tokenHash === tokenHash && !candidate.revokedAt,
      );
      if (!record) return null;
      return {
        credentialId: record.id,
        userId: record.userId,
        verified: record.verifiedAt !== null,
      };
    },
  };
  return { records, repository };
};

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

    await expect(credentials.issue({ userId: "user_1" })).resolves.toEqual({
      credential: {
        id: "credential_1",
        name: null,
        tokenSuffix: "aaaa",
        createdAt: issuedAt.toISOString(),
        verifiedAt: null,
      },
      token: `rssc_${"a".repeat(25)}`,
    });
    expect(state.records[0]?.tokenHash).not.toContain("rssc_");
    expect(state.records[0]?.tokenSuffix).toBe("aaaa");
  });

  it("認証成功時にcredentialId/userIdと確定済みかどうかを返す", async () => {
    const state = createRepository();
    let currentDate = issuedAt;
    const token = `rssc_${"b".repeat(25)}`;
    const credentials = createShortcutCredentials({
      repository: state.repository,
      createId: () => "credential_1",
      createToken: () => token,
      getCurrentDate: () => currentDate,
    });
    await credentials.issue({ userId: "user_1" });

    currentDate = usedAt;
    await expect(credentials.authenticate({ token })).resolves.toEqual({
      credentialId: "credential_1",
      userId: "user_1",
      verified: false,
    });
  });

  /**
   * 発行は連携の完了ではない。初回の共有で届いたデバイス名を端末名として確定し、
   * 以後は`verified`がtrueになるので確定の書き込みへ進まない (ADR 0025)。
   */
  it("初回の共有でデバイス名と連携日時を確定し、2回目以降は上書きしない", async () => {
    const state = createRepository();
    let currentDate = issuedAt;
    const token = `rssc_${"d".repeat(25)}`;
    const credentials = createShortcutCredentials({
      repository: state.repository,
      createId: () => "credential_1",
      createToken: () => token,
      getCurrentDate: () => currentDate,
    });
    await credentials.issue({ userId: "user_1" });

    currentDate = usedAt;
    await credentials.markVerified({
      credentialId: "credential_1",
      deviceName: "  たかしのiPhone  ",
    });

    await expect(credentials.list("user_1")).resolves.toEqual([
      {
        id: "credential_1",
        name: "たかしのiPhone",
        tokenSuffix: "dddd",
        createdAt: issuedAt.toISOString(),
        verifiedAt: usedAt.toISOString(),
      },
    ]);
    await expect(credentials.authenticate({ token })).resolves.toMatchObject({ verified: true });

    await credentials.markVerified({ credentialId: "credential_1", deviceName: "別のiPad" });
    await expect(credentials.list("user_1")).resolves.toMatchObject([
      { name: "たかしのiPhone", verifiedAt: usedAt.toISOString() },
    ]);
  });

  /**
   * デバイス名はiOSが決める文字列で、長さも中身も保証がない。
   */
  it("デバイス名を60文字で切り、空の名前は持たせない", async () => {
    const state = createRepository();
    let tokenChar = "e";
    const credentials = createShortcutCredentials({
      repository: state.repository,
      createId: () => `credential_${tokenChar}`,
      createToken: () => `rssc_${tokenChar.repeat(25)}`,
      getCurrentDate: () => issuedAt,
    });

    const verifyWith = async (deviceName: string | undefined) => {
      await credentials.issue({ userId: "user_1" });
      await credentials.markVerified({ credentialId: `credential_${tokenChar}`, deviceName });
      const record = state.records.find((candidate) => candidate.id === `credential_${tokenChar}`);
      tokenChar = String.fromCharCode(tokenChar.charCodeAt(0) + 1);
      return record;
    };

    await expect(verifyWith("あ".repeat(80))).resolves.toMatchObject({ name: "あ".repeat(60) });
    await expect(verifyWith("   ")).resolves.toMatchObject({ name: null, verifiedAt: issuedAt });
    await expect(verifyWith(undefined)).resolves.toMatchObject({
      name: null,
      verifiedAt: issuedAt,
    });
  });

  it("一覧はactive credentialだけを返し、revoke後のtokenを拒否する", async () => {
    const state = createRepository();
    let currentDate = issuedAt;
    const token = `rssc_${"c".repeat(25)}`;
    const credentials = createShortcutCredentials({
      repository: state.repository,
      createId: () => "credential_1",
      createToken: () => token,
      getCurrentDate: () => currentDate,
    });
    await credentials.issue({ userId: "user_1" });

    await expect(credentials.list("user_1")).resolves.toHaveLength(1);
    currentDate = usedAt;
    await expect(
      credentials.revoke({ credentialId: "credential_1", userId: "user_1" }),
    ).resolves.toBe(true);
    await expect(credentials.list("user_1")).resolves.toEqual([]);
    await expect(credentials.authenticate({ token })).resolves.toBeNull();
  });
});

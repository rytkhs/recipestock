import { shortcutCredentialTokenSchema } from "@recipestock/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  createShortcutCredentials,
  createShortcutCredentialToken,
  type ShortcutCredentialRecord,
} from "./shortcut-credentials";

const issuedAt = new Date("2026-07-11T00:00:00.000Z");
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

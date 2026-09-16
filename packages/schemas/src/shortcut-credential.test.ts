import { describe, expect, it } from "vitest";
import {
  issueShortcutCredentialResponseSchema,
  listShortcutCredentialsResponseSchema,
  shortcutCredentialTokenSchema,
} from "./shortcut-credential";

const credential = {
  id: "credential_1",
  name: "たかしのiPhone",
  tokenSuffix: "abcdef",
  createdAt: "2026-07-11T00:00:00.000Z",
  verifiedAt: "2026-07-11T00:01:00.000Z",
};

describe("Shortcut credential schemas", () => {
  it("発行responseを検証する", () => {
    expect(
      issueShortcutCredentialResponseSchema.safeParse({
        credential,
        token: `rssc_${"a".repeat(25)}`,
      }).success,
    ).toBe(true);
  });

  /**
   * 端末名は初回の共有でShortcutから届くので、発行した直後は名前も連携日時もない。
   */
  it("未使用のcredentialはnameとverifiedAtを持たない", () => {
    expect(
      listShortcutCredentialsResponseSchema.safeParse({
        credentials: [{ ...credential, name: null, verifiedAt: null }],
      }).success,
    ).toBe(true);
    expect(
      listShortcutCredentialsResponseSchema.safeParse({
        credentials: [{ ...credential, name: undefined, verifiedAt: undefined }],
      }).success,
    ).toBe(false);
  });

  it("active credential一覧を検証する", () => {
    expect(listShortcutCredentialsResponseSchema.parse({ credentials: [] })).toEqual({
      credentials: [],
    });
  });

  /**
   * 認証の前に形式を検査し、合わないトークンをhash照合のDBアクセスへ到達させない。
   */
  it("トークンの形式を検査する", () => {
    expect(shortcutCredentialTokenSchema.safeParse(`rssc_${"a".repeat(25)}`).success).toBe(true);
    expect(shortcutCredentialTokenSchema.safeParse(`rssc_${"a".repeat(24)}`).success).toBe(false);
    expect(shortcutCredentialTokenSchema.safeParse(`rssc_${"a".repeat(26)}`).success).toBe(false);
    expect(shortcutCredentialTokenSchema.safeParse(`rssc_${"あ".repeat(25)}`).success).toBe(false);
    expect(shortcutCredentialTokenSchema.safeParse("ここに貼り付けてください").success).toBe(false);
  });
});

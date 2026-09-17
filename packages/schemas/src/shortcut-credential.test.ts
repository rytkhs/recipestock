import { describe, expect, it } from "vitest";
import {
  issueShortcutCredentialRequestSchema,
  issueShortcutCredentialResponseSchema,
  listShortcutCredentialsResponseSchema,
} from "./shortcut-credential";

describe("Shortcut credential schemas", () => {
  it("名前をtrimし、発行responseを検証する", () => {
    expect(issueShortcutCredentialRequestSchema.parse({ name: " iPhone " })).toEqual({
      name: "iPhone",
    });
    expect(
      issueShortcutCredentialResponseSchema.safeParse({
        credential: {
          id: "credential_1",
          name: "iPhone",
          tokenSuffix: "abcdef",
          createdAt: "2026-07-11T00:00:00.000Z",
          firstUsedAt: null,
        },
        token: `rssc_${"a".repeat(25)}`,
      }).success,
    ).toBe(true);
  });

  it("active credential一覧を検証する", () => {
    expect(listShortcutCredentialsResponseSchema.parse({ credentials: [] })).toEqual({
      credentials: [],
    });
  });

  it("初回利用時刻は未使用ならnullで、省略は受け付けない", () => {
    const credential = {
      id: "credential_1",
      name: "iPhone",
      tokenSuffix: "abcd",
      createdAt: "2026-07-11T00:00:00.000Z",
    };

    expect(
      listShortcutCredentialsResponseSchema.safeParse({
        credentials: [
          { ...credential, firstUsedAt: null },
          { ...credential, id: "credential_2", firstUsedAt: "2026-07-11T00:05:00.000Z" },
        ],
      }).success,
    ).toBe(true);
    expect(
      listShortcutCredentialsResponseSchema.safeParse({ credentials: [credential] }).success,
    ).toBe(false);
  });
});

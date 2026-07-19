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
        },
        token: `rssc_${"a".repeat(64)}`,
      }).success,
    ).toBe(true);
  });

  it("active credential一覧を検証する", () => {
    expect(listShortcutCredentialsResponseSchema.parse({ credentials: [] })).toEqual({
      credentials: [],
    });
  });
});

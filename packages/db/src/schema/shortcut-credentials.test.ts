import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { shortcutCredentials } from "./shortcut-credentials";

describe("Shortcut credential schema", () => {
  it("token hashを一意にする", () => {
    expect(getTableName(shortcutCredentials)).toBe("shortcut_credentials");
    expect(getTableConfig(shortcutCredentials).indexes.map((index) => index.config.name)).toContain(
      "shortcut_credentials_token_hash_uidx",
    );
  });
});

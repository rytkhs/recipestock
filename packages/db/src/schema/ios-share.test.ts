import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { iosShareChannels, iosShareHandoffs } from "./ios-share";

describe("iOS share schema", () => {
  it("Shortcut credential token hashを一意にする", () => {
    expect(getTableName(iosShareChannels)).toBe("ios_share_channels");
    expect(getTableConfig(iosShareChannels).indexes.map((index) => index.config.name)).toContain(
      "ios_share_channels_token_hash_uidx",
    );
  });

  it("ユーザーごとの未配送handoffを一件に制限する", () => {
    expect(getTableName(iosShareHandoffs)).toBe("ios_share_handoffs");
    expect(getTableConfig(iosShareHandoffs).indexes.map((index) => index.config.name)).toContain(
      "ios_share_handoffs_user_pending_uidx",
    );
  });
});

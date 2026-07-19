import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { pushSubscriptions } from "./push-subscriptions";

describe("Push subscription schema", () => {
  it("endpointを一意にし、ユーザー単位で検索できる", () => {
    expect(getTableName(pushSubscriptions)).toBe("push_subscriptions");

    const indexes = getTableConfig(pushSubscriptions).indexes;
    expect(
      indexes.find((index) => index.config.name === "push_subscriptions_endpoint_uidx")?.config
        .unique,
    ).toBe(true);
    expect(indexes.map((index) => index.config.name)).toContain("push_subscriptions_user_id_idx");
  });
});

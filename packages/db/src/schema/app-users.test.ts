import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { appUsers, stripeEvents, subscriptions } from "./app-users";

describe("appUsers schema", () => {
  it("テーブル名にapp_usersを使う", () => {
    expect(getTableName(appUsers)).toBe("app_users");
  });

  it("Stripe Customer IDにNULL除外のunique indexを持つ", () => {
    const config = getTableConfig(appUsers);

    expect(config.indexes.map((index) => index.config.name)).toContain(
      "app_users_stripe_customer_id_uidx",
    );
  });
});

describe("subscriptions schema", () => {
  it("テーブル名にsubscriptionsを使う", () => {
    expect(getTableName(subscriptions)).toBe("subscriptions");
  });

  it("Stripe同期用の主要indexを持つ", () => {
    const config = getTableConfig(subscriptions);

    expect(config.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "subscriptions_stripe_subscription_id_uidx",
        "subscriptions_user_id_idx",
        "subscriptions_stripe_customer_id_idx",
        "subscriptions_user_status_idx",
      ]),
    );
  });
});

describe("stripeEvents schema", () => {
  it("テーブル名にstripe_eventsを使う", () => {
    expect(getTableName(stripeEvents)).toBe("stripe_events");
  });
});

import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { appUsers } from "./app-users";

describe("appUsers schema", () => {
  it("テーブル名にapp_usersを使う", () => {
    expect(getTableName(appUsers)).toBe("app_users");
  });
});

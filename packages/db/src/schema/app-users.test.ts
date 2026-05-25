import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { appUsers } from "./app-users";

describe("appUsers schema", () => {
  it("uses app_users as the table name", () => {
    expect(getTableName(appUsers)).toBe("app_users");
  });
});

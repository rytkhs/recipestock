import { NeonDbError } from "@neondatabase/serverless";
import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { isDatabaseUnavailableError, withoutQueryParams } from "./errors";

const connectionError = () => {
  const error = new NeonDbError("Error connecting to database: TypeError: fetch failed");
  error.sourceError = new TypeError("fetch failed");
  return error;
};

describe("isDatabaseUnavailableError", () => {
  it("Neonが結果を返せなかった失敗を、queryの失敗に包まれていても障害とみなす", () => {
    const error = new DrizzleQueryError(
      "select 1",
      [],
      new NeonDbError("Server error (HTTP status 520): error code: 520"),
    );

    expect(isDatabaseUnavailableError(error)).toBe(true);
  });

  it("Neonへ届かなかった失敗を障害とみなす", () => {
    expect(
      isDatabaseUnavailableError(new DrizzleQueryError("select 1", [], connectionError())),
    ).toBe(true);
  });

  it("SQLの誤りや制約違反は障害とみなさない", () => {
    const constraintError = new NeonDbError(
      'duplicate key value violates unique constraint "tags_pkey"',
    );
    constraintError.code = "23505";

    expect(
      isDatabaseUnavailableError(new DrizzleQueryError("insert into tags", [], constraintError)),
    ).toBe(false);
    expect(isDatabaseUnavailableError(new Error("boom"))).toBe(false);
    expect(isDatabaseUnavailableError(undefined)).toBe(false);
  });
});

describe("withoutQueryParams", () => {
  it("失敗したqueryのメッセージから、改行を含む引数まで除く", () => {
    const error = new DrizzleQueryError(
      "select id from shortcut_credentials where token_hash = $1",
      ["token-hash", "recipe body\nparams: second line"],
    );

    expect(withoutQueryParams(error.message)).toBe(
      "Failed query: select id from shortcut_credentials where token_hash = $1",
    );
  });

  it("queryの失敗でないメッセージは変えない", () => {
    expect(withoutQueryParams("Server error (HTTP status 520): error code: 520")).toBe(
      "Server error (HTTP status 520): error code: 520",
    );
  });
});

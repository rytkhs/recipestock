import { NeonDbError } from "@neondatabase/serverless";

const maxCauseDepth = 5;

// Neonへ届かなかった、またはNeonが結果を返せなかった失敗。どのqueryで起きても同じ障害として扱う。
// SQLの誤りや制約違反はNeonがHTTP 400で返すので含めない。
export const isDatabaseUnavailableError = (error: unknown) => {
  let current = error;

  for (let depth = 0; current instanceof Error && depth < maxCauseDepth; depth += 1) {
    if (
      current instanceof NeonDbError &&
      (current.sourceError !== undefined ||
        current.message.startsWith("Server error (HTTP status "))
    ) {
      return true;
    }

    current = current.cause;
  }

  return false;
};

const failedQueryPrefix = "Failed query: ";
const queryParamsMarker = "\nparams: ";

// Drizzleが失敗したqueryにつけるメッセージから引数を除く。
// 引数には利用者が入力した本文やtokenのハッシュが入るので、ログにも監視にも出さない。
export const withoutQueryParams = (message: string) => {
  if (!message.startsWith(failedQueryPrefix)) {
    return message;
  }

  const paramsIndex = message.indexOf(queryParamsMarker);
  return paramsIndex === -1 ? message : message.slice(0, paramsIndex);
};

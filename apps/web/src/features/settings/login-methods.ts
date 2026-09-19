import { useQuery } from "@tanstack/react-query";
import { listAccountProviders } from "../../lib/auth";

export const loginMethodsQueryKey = ["login-methods"] as const;

export type LoginMethods = {
  /** Googleでログインできる。 */
  hasGoogle: boolean;
  /** メールアドレスとパスワードでログインできる。 */
  hasPassword: boolean;
};

export const fetchLoginMethods = async (): Promise<LoginMethods> => {
  const providerIds = await listAccountProviders();

  return {
    hasGoogle: providerIds.includes("google"),
    hasPassword: providerIds.includes("credential"),
  };
};

/**
 * ログイン方法は、このアプリからは増やせも減らせもしない。
 * パスワードの再設定だけは"credential"を作るが、そのときは全端末がログアウトされ、
 * ログアウトでこのキャッシュごと消える(lib/query-cache.ts)。開いているあいだは読み直さない。
 */
export const useLoginMethods = () =>
  useQuery({
    queryKey: loginMethodsQueryKey,
    queryFn: fetchLoginMethods,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

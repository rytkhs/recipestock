import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useAuthSession } from "./auth";

export type AuthStatus = "pending" | "authenticated" | "unauthenticated";

type AuthSession = ReturnType<typeof useAuthSession>;

type AuthState = {
  session: AuthSession;
  status: AuthStatus;
};

const AuthStateContext = createContext<AuthState | null>(null);

export const AuthStateProvider = ({ children }: { children: ReactNode }) => {
  const session = useAuthSession();
  const [hasCompletedInitialCheck, setHasCompletedInitialCheck] = useState(
    () => !session.isPending || Boolean(session.data) || Boolean(session.error),
  );

  useEffect(() => {
    if (!session.isPending || session.data || session.error) {
      setHasCompletedInitialCheck(true);
    }
  }, [session.data, session.error, session.isPending]);

  const status: AuthStatus = !hasCompletedInitialCheck
    ? "pending"
    : session.data
      ? "authenticated"
      : "unauthenticated";
  const value = useMemo(() => ({ session, status }), [session, status]);

  return <AuthStateContext.Provider value={value}>{children}</AuthStateContext.Provider>;
};

export const useAuthState = () => {
  const value = useContext(AuthStateContext);

  if (!value) {
    throw new Error("auth_state_provider_missing");
  }

  return value;
};

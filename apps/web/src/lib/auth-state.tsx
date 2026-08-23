import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getAuthSession, getFreshAuthSession, useAuthSession } from "./auth";

export type AuthCheckResult = "authenticated" | "unauthenticated" | "unavailable";
export type AuthStatus = "pending" | AuthCheckResult;
export type AuthRecheckMode = "cache-aware" | "fresh";

type AuthSession = ReturnType<typeof useAuthSession>;

export type AuthState = {
  status: AuthStatus;
  recheck: (mode?: AuthRecheckMode) => Promise<AuthCheckResult>;
  isRechecking: boolean;
};

const AuthStateContext = createContext<AuthState | null>(null);

const statusForSession = (
  data: AuthSession["data"],
  error: AuthSession["error"],
  hasCompletedInitialCheck: boolean,
): AuthStatus => {
  if (data) return "authenticated";
  if (!hasCompletedInitialCheck) return "pending";
  if (error) return "unavailable";
  return "unauthenticated";
};

export const AuthStateProvider = ({ children }: { children: ReactNode }) => {
  const session = useAuthSession();
  const [hasCompletedInitialCheck, setHasCompletedInitialCheck] = useState(
    () => !session.isPending || Boolean(session.data) || Boolean(session.error),
  );
  const [status, setStatus] = useState<AuthStatus>(() =>
    statusForSession(session.data, session.error, hasCompletedInitialCheck),
  );
  const [activeRecheckCount, setActiveRecheckCount] = useState(0);
  const recheckPromises = useRef<Partial<Record<AuthRecheckMode, Promise<AuthCheckResult>>>>({});

  useEffect(() => {
    if (!session.isPending || session.data || session.error) {
      setHasCompletedInitialCheck(true);
    }
  }, [session.data, session.error, session.isPending]);

  useEffect(() => {
    setStatus(statusForSession(session.data, session.error, hasCompletedInitialCheck));
  }, [hasCompletedInitialCheck, session.data, session.error]);

  const recheck = useCallback((mode: AuthRecheckMode = "cache-aware") => {
    const inFlight = recheckPromises.current[mode];
    if (inFlight) return inFlight;

    setActiveRecheckCount((count) => count + 1);
    const request = (async (): Promise<AuthCheckResult> => {
      try {
        const result = await (mode === "fresh" ? getFreshAuthSession() : getAuthSession());
        const nextStatus: AuthCheckResult = result.error
          ? "unavailable"
          : result.data
            ? "authenticated"
            : "unauthenticated";
        setHasCompletedInitialCheck(true);
        setStatus(nextStatus);
        return nextStatus;
      } catch {
        setHasCompletedInitialCheck(true);
        setStatus("unavailable");
        return "unavailable";
      } finally {
        delete recheckPromises.current[mode];
        setActiveRecheckCount((count) => Math.max(0, count - 1));
      }
    })();

    recheckPromises.current[mode] = request;
    return request;
  }, []);

  const value = useMemo(
    () => ({ status, recheck, isRechecking: activeRecheckCount > 0 }),
    [activeRecheckCount, recheck, status],
  );

  return <AuthStateContext.Provider value={value}>{children}</AuthStateContext.Provider>;
};

export const useAuthState = () => {
  const value = useContext(AuthStateContext);

  if (!value) {
    throw new Error("auth_state_provider_missing");
  }

  return value;
};

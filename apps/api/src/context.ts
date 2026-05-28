import { type AuthSession } from "./auth";
import { type Bindings } from "./env";

export type ApiVariables = {
  authSession: AuthSession;
  userId: string;
};

export type ApiEnv = {
  Bindings: Bindings;
  Variables: ApiVariables;
};

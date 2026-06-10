import { type AuthSession } from "./auth";
import { type Bindings } from "./env";
import { type Logger } from "./logger";

export type ApiVariables = {
  authSession: AuthSession;
  logger: Logger;
  requestId: string;
  userId: string;
};

export type ApiEnv = {
  Bindings: Bindings;
  Variables: ApiVariables;
};

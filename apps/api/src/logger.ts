type LogLevel = "info" | "warn" | "error";

type ErrorLogValue = {
  message: string;
  name: string;
  stack?: string;
};

type LogFields = Record<string, unknown>;

type BaseLogFields = {
  requestId?: string;
  route?: string;
  userId?: string;
};

export type Logger = {
  error: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
};

const normalizeError = (error: Error): ErrorLogValue => ({
  message: error.message,
  name: error.name,
  stack: error.stack,
});

const normalizeLogValue = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (value === undefined) {
    return undefined;
  }

  if (value instanceof Error) {
    return removeUndefined(normalizeError(value));
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeLogValue(item, seen)).filter((item) => item !== undefined);
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    return removeUndefined(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, normalizeLogValue(item, seen)]),
      ),
    );
  }

  return value;
};

const removeUndefined = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

const writeLog = (level: LogLevel, event: string, baseFields: BaseLogFields, fields: LogFields) => {
  const entry = removeUndefined({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...baseFields,
    ...fields,
  });
  const line = JSON.stringify(normalizeLogValue(entry));

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.info(line);
};

export const createLogger = (baseFields: BaseLogFields = {}): Logger => ({
  error: (event, fields = {}) => writeLog("error", event, baseFields, fields),
  info: (event, fields = {}) => writeLog("info", event, baseFields, fields),
  warn: (event, fields = {}) => writeLog("warn", event, baseFields, fields),
});

type LogLevel = "info" | "warn" | "error";

type ErrorLogValue = {
  message: string;
  name: string;
  stack?: string;
};

type LogFields = Record<string, unknown>;

export type BaseLogFields = {
  jobId?: string;
  messageId?: string;
  requestId?: string;
  route?: string;
  sourceHost?: string;
  userId?: string;
};

export type Logger = {
  error: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
};

export type LoggerFactory = (baseFields?: BaseLogFields) => Logger;

export type LogEntry = LogFields & {
  event: string;
  level: LogLevel;
  timestamp: string;
};

export type LogSink = {
  write: (entry: LogEntry) => void;
};

export type MemoryLogSink = LogSink & {
  clear: () => void;
  entries: LogEntry[];
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

export const createConsoleLogSink = (): LogSink => ({
  write(entry) {
    const line = JSON.stringify(entry);

    if (entry.level === "error") {
      console.error(line);
      return;
    }

    if (entry.level === "warn") {
      console.warn(line);
      return;
    }

    console.info(line);
  },
});

export const createNoopLogSink = (): LogSink => ({
  write: () => undefined,
});

export const createMemoryLogSink = (): MemoryLogSink => {
  const entries: LogEntry[] = [];

  return {
    entries,
    clear: () => {
      entries.length = 0;
    },
    write: (entry) => {
      entries.push(entry);
    },
  };
};

const defaultLogSink = createConsoleLogSink();

const writeLog = (
  sink: LogSink,
  level: LogLevel,
  event: string,
  baseFields: BaseLogFields,
  fields: LogFields,
) => {
  const entry = normalizeLogValue(
    removeUndefined({
      level,
      event,
      timestamp: new Date().toISOString(),
      ...baseFields,
      ...fields,
    }),
  ) as LogEntry;

  sink.write(entry);
};

export const createLogger = (
  baseFields: BaseLogFields = {},
  { sink = defaultLogSink }: { sink?: LogSink } = {},
): Logger => ({
  error: (event, fields = {}) => writeLog(sink, "error", event, baseFields, fields),
  info: (event, fields = {}) => writeLog(sink, "info", event, baseFields, fields),
  warn: (event, fields = {}) => writeLog(sink, "warn", event, baseFields, fields),
});

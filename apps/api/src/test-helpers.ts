import { type AppDependencies, createApp } from "./index";
import { createLogger, createNoopLogSink, type LoggerFactory } from "./logger";

export const createNoopLoggerFactory = (): LoggerFactory => {
  const sink = createNoopLogSink();

  return (baseFields) => createLogger(baseFields, { sink });
};

export const createSilentTestApp = (dependencies: AppDependencies = {}) =>
  createApp({
    ...dependencies,
    loggerFactory: dependencies.loggerFactory ?? createNoopLoggerFactory(),
  });

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createConsoleLogSink,
  createLogger,
  createMemoryLogSink,
  createNoopLogSink,
} from "./logger";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("logger", () => {
  it("Error、undefined、循環参照を正規化してmemory sinkへ保存する", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    const sink = createMemoryLogSink();
    const logger = createLogger({ requestId: "request_123", route: "/api/test" }, { sink });
    const circular: Record<string, unknown> = { name: "root" };
    circular.self = circular;
    const error = new Error("database failed");

    logger.error("api_request_failed", {
      circular,
      error,
      nested: {
        keep: "value",
        omit: undefined,
      },
      omit: undefined,
    });

    expect(sink.entries).toEqual([
      {
        level: "error",
        event: "api_request_failed",
        timestamp: "2026-06-01T00:00:00.000Z",
        requestId: "request_123",
        route: "/api/test",
        circular: {
          name: "root",
          self: "[Circular]",
        },
        error: {
          message: "database failed",
          name: "Error",
          stack: expect.any(String),
        },
        nested: {
          keep: "value",
        },
      },
    ]);
  });

  it("console sinkはlevelごとにconsoleへJSONを出力する", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createLogger({}, { sink: createConsoleLogSink() });

    logger.info("info_event", { status: 200 });
    logger.warn("warn_event", { status: 400 });
    logger.error("error_event", { status: 500 });

    expect(info).toHaveBeenCalledWith(
      JSON.stringify({
        level: "info",
        event: "info_event",
        timestamp: "2026-06-01T00:00:00.000Z",
        status: 200,
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      JSON.stringify({
        level: "warn",
        event: "warn_event",
        timestamp: "2026-06-01T00:00:00.000Z",
        status: 400,
      }),
    );
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({
        level: "error",
        event: "error_event",
        timestamp: "2026-06-01T00:00:00.000Z",
        status: 500,
      }),
    );
  });

  it("noop sinkはconsoleへ出力しない", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createLogger({}, { sink: createNoopLogSink() });

    logger.info("info_event");
    logger.warn("warn_event");
    logger.error("error_event");

    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("memory sinkはclearでentriesを空にする", () => {
    const sink = createMemoryLogSink();
    const logger = createLogger({}, { sink });

    logger.info("info_event");
    sink.clear();

    expect(sink.entries).toEqual([]);
  });
});

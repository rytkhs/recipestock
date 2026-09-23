import { describe, expect, it } from "vitest";
import {
  checkImportQueueHealth,
  evaluateImportQueueHealth,
  IMPORT_QUEUE_STALL_MARGIN_MS,
} from "./import-queue-health";
import { createLogger, createMemoryLogSink } from "./logger";

const jobTimeoutMs = 600_000;
const now = new Date("2026-06-01T01:00:00.000Z");
const stallThresholdMs = jobTimeoutMs + IMPORT_QUEUE_STALL_MARGIN_MS;

const metricsWithOldestAge = (ageMs: number | null): QueueMetrics => ({
  backlogCount: ageMs === null ? 0 : 3,
  backlogBytes: ageMs === null ? 0 : 120,
  oldestMessageTimestamp: ageMs === null ? undefined : new Date(now.getTime() - ageMs),
});

describe("evaluateImportQueueHealth", () => {
  it.each([
    ["空のqueue", null, false],
    ["閾値ちょうどの滞留", stallThresholdMs, false],
    ["閾値を超えた滞留", stallThresholdMs + 1, true],
  ] as const)("%sを判定する", (_label, ageMs, stalled) => {
    expect(
      evaluateImportQueueHealth({ jobTimeoutMs, metrics: metricsWithOldestAge(ageMs), now }),
    ).toEqual({
      backlogCount: ageMs === null ? 0 : 3,
      oldestMessageAgeMs: ageMs,
      stallThresholdMs,
      stalled,
    });
  });

  it("件数が多くても最古のメッセージが新しければ停滞としない", () => {
    expect(
      evaluateImportQueueHealth({
        jobTimeoutMs,
        metrics: { backlogCount: 500, backlogBytes: 20_000, oldestMessageTimestamp: now },
        now,
      }).stalled,
    ).toBe(false);
  });
});

describe("checkImportQueueHealth", () => {
  const run = async (queue: Pick<Queue, "metrics">) => {
    const sink = createMemoryLogSink();
    const checkIns: string[] = [];
    const result = checkImportQueueHealth({
      jobTimeoutMs,
      logger: createLogger({}, { sink }),
      now: () => now,
      queue,
      reportCheckIn: (status) => {
        checkIns.push(status);
      },
    });

    return { checkIns, result, sink };
  };

  it("滞留がなければokでcheck-inする", async () => {
    const { checkIns, result, sink } = await run({
      metrics: async () => metricsWithOldestAge(60_000),
    });

    await expect(result).resolves.toBeUndefined();
    expect(checkIns).toEqual(["ok"]);
    expect(sink.entries).toEqual([
      expect.objectContaining({
        event: "import_queue_health_checked",
        level: "info",
        backlogCount: 3,
        oldestMessageAgeMs: 60_000,
      }),
    ]);
  });

  it("停滞は例外にせずerrorでcheck-inしてログに残す", async () => {
    const { checkIns, result, sink } = await run({
      metrics: async () => metricsWithOldestAge(stallThresholdMs + 1),
    });

    await expect(result).resolves.toBeUndefined();
    expect(checkIns).toEqual(["error"]);
    expect(sink.entries).toEqual([
      expect.objectContaining({ event: "import_queue_stalled", level: "error", stalled: true }),
    ]);
  });

  it("metricsを読めなければerrorでcheck-inして例外を返す", async () => {
    const error = new Error("metrics unavailable");
    const { checkIns, result } = await run({
      metrics: async () => {
        throw error;
      },
    });

    await expect(result).rejects.toBe(error);
    expect(checkIns).toEqual(["error"]);
  });
});

import { type Logger } from "./logger";
import { type CheckInReporter } from "./monitoring";

/**
 * 期限を過ぎたImport Jobは、次の配信で即座に`job_timeout`になりackされる。
 * 期限の直前に届いた配信の処理と、その後の再試行の待ち（最長240秒）を見込んでも、
 * この余裕を超えて未ackのメッセージが残るならconsumerが捌けていない。
 */
export const IMPORT_QUEUE_STALL_MARGIN_MS = 5 * 60 * 1000;

export type ImportQueueHealth = {
  backlogCount: number;
  oldestMessageAgeMs: number | null;
  stallThresholdMs: number;
  stalled: boolean;
};

/**
 * backlogの件数では判定しない。この規模では件数の多さは故障を意味せず、
 * 止まっていることは最古のメッセージの滞留時間に現れる。
 */
export const evaluateImportQueueHealth = ({
  jobTimeoutMs,
  metrics,
  now,
}: {
  jobTimeoutMs: number;
  metrics: QueueMetrics;
  now: Date;
}): ImportQueueHealth => {
  const stallThresholdMs = jobTimeoutMs + IMPORT_QUEUE_STALL_MARGIN_MS;
  const oldestMessageAgeMs = metrics.oldestMessageTimestamp
    ? now.getTime() - metrics.oldestMessageTimestamp.getTime()
    : null;

  return {
    backlogCount: metrics.backlogCount,
    oldestMessageAgeMs,
    stallThresholdMs,
    stalled: oldestMessageAgeMs !== null && oldestMessageAgeMs > stallThresholdMs,
  };
};

/**
 * Neonには触れない。5分ごとに叩くとscale-to-zeroが効かなくなるため、Queueのmetricsだけを見る。
 * 停滞は例外にせずcheck-inの`error`で伝える。例外にするとissueとmonitorの二重通知になる。
 */
export const checkImportQueueHealth = async ({
  jobTimeoutMs,
  logger,
  now,
  queue,
  reportCheckIn,
}: {
  jobTimeoutMs: number;
  logger: Logger;
  now: () => Date;
  queue: Pick<Queue, "metrics">;
  reportCheckIn: CheckInReporter;
}) => {
  let health: ImportQueueHealth;

  try {
    health = evaluateImportQueueHealth({
      jobTimeoutMs,
      metrics: await queue.metrics(),
      now: now(),
    });
  } catch (error) {
    reportCheckIn("error");
    throw error;
  }

  if (health.stalled) {
    logger.error("import_queue_stalled", health);
  } else {
    logger.info("import_queue_health_checked", health);
  }

  reportCheckIn(health.stalled ? "error" : "ok");
};

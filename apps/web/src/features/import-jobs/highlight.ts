import { useSyncExternalStore } from "react";

const highlightDurationMs = 3000;

let highlightedJobId: string | null = null;
let clearTimer: number | undefined;
const listeners = new Set<() => void>();

const setHighlightedJobId = (jobId: string | null) => {
  highlightedJobId = jobId;

  for (const listener of listeners) {
    listener();
  }
};

/**
 * 同じURLや原文をもう一度送ったときに、取り込み中のjobをしばらく目立たせる。
 */
export const highlightImportJob = (jobId: string) => {
  window.clearTimeout(clearTimer);
  setHighlightedJobId(jobId);
  clearTimer = window.setTimeout(() => setHighlightedJobId(null), highlightDurationMs);
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useHighlightedImportJobId = () =>
  useSyncExternalStore(subscribe, () => highlightedJobId);

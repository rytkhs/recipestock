import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAvailabilityRecovery } from "./availability-recovery";

describe("useAvailabilityRecovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("指定したdelayを使って有限回だけ自動再試行する", async () => {
    const retryDependency = vi.fn(async () => false);
    renderHook(() =>
      useAvailabilityRecovery({
        active: true,
        retryDependency,
        retryDelays: [20, 50, 150],
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(220);
    });
    expect(retryDependency).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(retryDependency).toHaveBeenCalledTimes(3);
  });

  it("browser eventは自動試行を使い切った後も再試行する", async () => {
    const retryDependency = vi.fn(async () => false);
    renderHook(() =>
      useAvailabilityRecovery({
        active: true,
        retryDependency,
        retryDelays: [10],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    expect(retryDependency).toHaveBeenCalledTimes(2);
  });

  it("manual retryのin-flight requestを共有する", async () => {
    let resolveRetry: ((value: boolean) => void) | undefined;
    const retryDependency = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRetry = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useAvailabilityRecovery({
        active: true,
        retryDependency,
        retryDelays: [],
      }),
    );

    let firstRetry: Promise<void>;
    let secondRetry: Promise<void>;
    act(() => {
      firstRetry = result.current.retry();
      secondRetry = result.current.retry();
    });
    expect(retryDependency).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRetry?.(true);
      await Promise.all([firstRetry, secondRetry]);
    });
    expect(result.current.isRetrying).toBe(false);
  });

  it("recovery後はbrowser eventで再試行しない", async () => {
    const retryDependency = vi.fn(async () => true);
    renderHook(() =>
      useAvailabilityRecovery({
        active: true,
        retryDependency,
        retryDelays: [10],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(retryDependency).toHaveBeenCalledTimes(1);
  });
});

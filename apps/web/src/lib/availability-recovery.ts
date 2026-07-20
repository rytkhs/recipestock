import { useCallback, useEffect, useRef, useState } from "react";

const defaultRetryDelays = [2_000, 5_000, 15_000] as const;

type AvailabilityRecoveryOptions = {
  active: boolean;
  retryDependency: () => Promise<boolean>;
  retryDelays?: readonly number[];
};

export const useAvailabilityRecovery = ({
  active,
  retryDependency,
  retryDelays = defaultRetryDelays,
}: AvailabilityRecoveryOptions) => {
  const [isRetrying, setIsRetrying] = useState(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const retryIndex = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recovered = useRef(false);
  const scheduleNext = useRef<() => void>(() => undefined);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const runRetry = useCallback(async () => {
    if (inFlight.current) return inFlight.current;

    setIsRetrying(true);
    const request = retryDependency()
      .then((didRecover) => {
        if (didRecover) {
          recovered.current = true;
          clearTimer();
        }
        return didRecover;
      })
      .finally(() => {
        inFlight.current = null;
        setIsRetrying(false);
      });

    inFlight.current = request;
    return request;
  }, [clearTimer, retryDependency]);

  useEffect(() => {
    if (!active) {
      clearTimer();
      retryIndex.current = 0;
      recovered.current = false;
      return;
    }

    const scheduleNextRetry = () => {
      clearTimer();
      const delay = retryDelays[retryIndex.current];
      if (delay === undefined || recovered.current) return;

      timer.current = setTimeout(() => {
        timer.current = null;
        retryIndex.current += 1;
        void runRetry().then((didRecover) => {
          if (!didRecover) scheduleNextRetry();
        });
      }, delay);
    };
    scheduleNext.current = scheduleNextRetry;

    const retryFromBrowserEvent = () => {
      if (recovered.current) return;
      clearTimer();
      void runRetry().then((didRecover) => {
        if (!didRecover) scheduleNextRetry();
      });
    };
    const retryWhenVisible = () => {
      if (document.visibilityState === "visible") retryFromBrowserEvent();
    };

    window.addEventListener("online", retryFromBrowserEvent);
    window.addEventListener("focus", retryFromBrowserEvent);
    document.addEventListener("visibilitychange", retryWhenVisible);
    scheduleNextRetry();

    return () => {
      scheduleNext.current = () => undefined;
      clearTimer();
      window.removeEventListener("online", retryFromBrowserEvent);
      window.removeEventListener("focus", retryFromBrowserEvent);
      document.removeEventListener("visibilitychange", retryWhenVisible);
    };
  }, [active, clearTimer, retryDelays, runRetry]);

  const retry = useCallback(async () => {
    clearTimer();
    const didRecover = await runRetry();
    if (!didRecover) scheduleNext.current();
  }, [clearTimer, runRetry]);

  return { retry, isRetrying };
};

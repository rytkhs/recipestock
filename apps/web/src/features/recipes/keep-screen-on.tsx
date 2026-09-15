import { Sun } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { tagChipClass } from "../tags/tag-chip";

const isScreenWakeLockSupported = () => typeof navigator !== "undefined" && "wakeLock" in navigator;

// 料理中に画面が暗くならないようにする。押している間だけスクリーンのwake lockを持ち、保存はしない。
// 別のアプリへ切り替えるとブラウザが手放すので、画面に戻ってきたら取り直す。
export const KeepScreenOnToggle = () => {
  const [isEnabled, setIsEnabled] = useState(false);

  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    let sentinel: WakeLockSentinel | null = null;
    let isRequesting = false;
    let isDisposed = false;

    const acquire = async () => {
      if (isRequesting || (sentinel && !sentinel.released)) {
        return;
      }

      isRequesting = true;

      try {
        const acquired = await navigator.wakeLock.request("screen");

        if (isDisposed) {
          void acquired.release();
          return;
        }

        sentinel = acquired;
      } catch {
        // 省電力モードなどで断られたら、押していない状態に戻す。
        if (!isDisposed) {
          setIsEnabled(false);
        }
      } finally {
        isRequesting = false;
      }
    };
    const reacquireWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", reacquireWhenVisible);

    return () => {
      isDisposed = true;
      document.removeEventListener("visibilitychange", reacquireWhenVisible);

      if (sentinel && !sentinel.released) {
        void sentinel.release();
      }
    };
  }, [isEnabled]);

  if (!isScreenWakeLockSupported()) {
    return null;
  }

  return (
    <button
      aria-pressed={isEnabled}
      className={tagChipClass(isEnabled)}
      type="button"
      onClick={() => setIsEnabled((current) => !current)}
    >
      <Sun weight={isEnabled ? "fill" : "bold"} />
      画面を消さない
    </button>
  );
};

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { useAuthState } from "../../lib/auth-state";
import { deliverIosShareHandoff, fetchPendingIosShareHandoff } from "./api";
import { isStandaloneWebApp } from "./display-mode";

export const IosShareHandoffReceiver = () => {
  const { status } = useAuthState();
  const navigate = useNavigate();
  const isReceivingRef = useRef(false);
  const lastDeliveredIdRef = useRef<string | null>(null);

  const receive = useCallback(async () => {
    if (status !== "authenticated" || !isStandaloneWebApp() || isReceivingRef.current) {
      return;
    }

    isReceivingRef.current = true;
    try {
      const { handoff } = await fetchPendingIosShareHandoff();
      if (!handoff || handoff.id === lastDeliveredIdRef.current) {
        return;
      }

      await navigate({
        to: "/import/url",
        search: {
          url: handoff.url,
          handoff: handoff.id,
          source: "ios-shortcut",
        },
      });
      await deliverIosShareHandoff(handoff.id, "pwa");
      lastDeliveredIdRef.current = handoff.id;
    } catch {
      // Shortcut側がSafari fallbackへ移行する。
    } finally {
      isReceivingRef.current = false;
    }
  }, [navigate, status]);

  useEffect(() => {
    const onPageShow = () => void receive();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void receive();
      }
    };

    void receive();
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [receive]);

  return null;
};

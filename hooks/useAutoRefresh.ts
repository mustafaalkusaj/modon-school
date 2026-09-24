"use client";

import { useCallback, useEffect, useRef } from "react";

interface UseAutoRefreshOptions {
  enabled?: boolean;
  intervalMs?: number;
  onRefresh: () => void | Promise<void>;
  refreshOnFocus?: boolean;
}

export function useAutoRefresh({
  enabled = true,
  intervalMs = 30_000,
  onRefresh,
  refreshOnFocus = true,
}: UseAutoRefreshOptions) {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const lastRefreshRef = useRef(Date.now());

  const doRefresh = useCallback(() => {
    lastRefreshRef.current = Date.now();
    void onRefreshRef.current();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const id = setInterval(doRefresh, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs, doRefresh]);

  useEffect(() => {
    if (!enabled || !refreshOnFocus) return;

    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const elapsed = Date.now() - lastRefreshRef.current;
      if (elapsed < 5_000) return;
      doRefresh();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [enabled, refreshOnFocus, doRefresh]);
}

"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { UserProfile } from "@/lib/auth";
import { DashboardNotification } from "../_components/types";

const NOTIFICATIONS_LIMIT = 25;

interface UseNotificationsProps {
  profile: UserProfile | null;
  scopeLoading: boolean;
}

function playNotificationSound() {
  try {
    const audio = new Audio("/sounds/notification.mp3");
    audio.volume = 0.5;
    audio.play().catch(() => {
      // Autoplay blocked or asset missing: fall back to a short Web Audio beep.
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.3;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.stop(ctx.currentTime + 0.3);
      } catch {
        // silent: audio not supported
      }
    });
  } catch {
    // silent: audio not supported
  }
}

export function useNotifications({ profile, scopeLoading }: UseNotificationsProps) {
  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notificationsUserId, setNotificationsUserId] = useState<string | null>(null);

  const fetchDashboardNotifications = useCallback(async () => {
    if (!profile || (profile.role !== "super_admin" && profile.role !== "admin")) {
      setNotifications([]);
      setNotificationsEnabled(false);
      setError(null);
      return;
    }

    setNotificationsLoading(true);
    setError(null);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;
      if (!userId) {
        setNotifications([]);
        setError("notifications_user_missing");
        return;
      }

      setNotificationsUserId(userId);

      const { data, error: fetchError } = await supabase
        .from("notifications")
        .select("id, title, message, type, is_read, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(NOTIFICATIONS_LIMIT);

      if (fetchError) {
        const relationMissing = fetchError.message.includes('relation "notifications" does not exist');
        setNotificationsEnabled(!relationMissing);
        setNotifications([]);
        if (!relationMissing) {
          console.error("[useNotifications] fetch error:", fetchError.message);
        }
        setError(relationMissing ? null : "dashboard_notifications_failed");
        return;
      }

      setNotificationsEnabled(true);
      setNotifications((data || []) as DashboardNotification[]);
      setError(null);
    } catch (caughtError) {
      setNotifications([]);
      setError(caughtError instanceof Error ? caughtError.message : "dashboard_notifications_failed");
    } finally {
      setNotificationsLoading(false);
    }
  }, [profile]);

  const markNotificationAsRead = useCallback(async (id: string) => {
    if (!id) return;
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    setNotifications((current) =>
      current.map((item) => (item.id === id ? { ...item, is_read: true } : item)),
    );
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!notificationsUserId) return;
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", notificationsUserId)
      .eq("is_read", false);
    setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
  }, [notificationsUserId]);

  useEffect(() => {
    if (!profile || scopeLoading) return;
    void fetchDashboardNotifications();
  }, [profile, scopeLoading, fetchDashboardNotifications]);

  // Supabase Realtime: surface new notifications immediately and play a sound.
  useEffect(() => {
    if (!notificationsUserId || !notificationsEnabled) return;

    const channel = supabase
      .channel(`dashboard-notifications:${notificationsUserId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${notificationsUserId}`,
        },
        (payload: { new: unknown }) => {
          const row = payload.new as DashboardNotification;
          setNotifications((current) => {
            if (current.some((item) => item.id === row.id)) return current;
            return [row, ...current].slice(0, NOTIFICATIONS_LIMIT);
          });
          playNotificationSound();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [notificationsUserId, notificationsEnabled]);

  const backgroundRefetch = useCallback(async () => {
    if (!profile || scopeLoading) return;
    if (profile.role !== "super_admin" && profile.role !== "admin") return;
    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;
      if (!userId) return;
      const { data } = await supabase
        .from("notifications")
        .select("id, title, message, type, is_read, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(NOTIFICATIONS_LIMIT);
      if (data) setNotifications(data as DashboardNotification[]);
    } catch { /* silent */ }
  }, [profile, scopeLoading]);

  useAutoRefresh({
    enabled: Boolean(profile && !scopeLoading && notificationsEnabled),
    intervalMs: 30_000,
    onRefresh: backgroundRefetch,
  });

  const unreadNotifications = useMemo(() => notifications.filter((item) => !item.is_read).length, [notifications]);

  return useMemo(() => ({
    notifications,
    notificationsEnabled,
    notificationsLoading,
    error,
    unreadNotifications,
    fetchDashboardNotifications,
    markNotificationAsRead,
    markAllAsRead,
  }), [notifications, notificationsEnabled, notificationsLoading, error, unreadNotifications, fetchDashboardNotifications, markNotificationAsRead, markAllAsRead]);
}

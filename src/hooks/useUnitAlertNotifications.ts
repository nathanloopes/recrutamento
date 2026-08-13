import type { UnitMetrics } from "@/hooks/useUnitMonitoring";

/**
 * Hook stub for unit alert notifications.
 * 
 * Alert notifications are now generated exclusively by backend triggers
 * (fn_notify_gargalo_detected, fn_notify_high_rejection_rate) and edge functions
 * (weekly-monitoring-report). This hook no longer inserts notifications
 * client-side to avoid duplication with backend-generated alerts.
 * 
 * Kept as a no-op to avoid breaking existing imports.
 */
export function useUnitAlertNotifications(
  _units: UnitMetrics[] | undefined,
  _config?: { alertChannels?: string[]; responseDelayDays?: number }
) {
  // No-op: alerts are handled server-side only
}

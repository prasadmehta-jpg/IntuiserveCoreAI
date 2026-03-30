/**
 * SANGATI Alert Router
 *
 * Given an alert draft and session context, determines the correct
 * routed_to_role. Zone-assignment-aware: prefers staff on-shift in zone.
 * Falls back gracefully to role-based routing.
 */

import { zoneAssignmentRepo } from '@sangati/db';
import type { AlertDraft } from './deviationEngine';
import type { StaffRole } from '@sangati/shared';

export interface RoutingContext {
  zone_id: string;
  now: Date;
}

/**
 * Returns the staff IDs on-shift for a zone right now.
 * Used to confirm a server is actually available before routing.
 */
export function getZoneStaffIds(zoneId: string, now: Date): string[] {
  const nowIso = now.toISOString();
  const staff = zoneAssignmentRepo.findStaffForZone(zoneId, nowIso);
  return staff.map(s => s.id);
}

/**
 * Resolves the routing role for an alert.
 * - wait_overdue: server on zone → if no server on zone, manager
 * - kitchen_overdue: always kitchen
 * - bill_overdue: server on zone (or manager if already escalated in draft)
 * - call_pending: server on zone → manager if escalated in draft
 */
export function resolveRoutingRole(
  draft: AlertDraft,
  ctx: RoutingContext
): StaffRole {
  // Kitchen alerts always go to kitchen role regardless of zone
  if (draft.type === 'kitchen_overdue') return 'kitchen';

  // If draft already escalated to manager, keep it
  if (draft.routed_to_role === 'manager') return 'manager';

  // Check if any server is on shift for this zone
  if (draft.zone_id ?? ctx.zone_id) {
    const zoneId = draft.routed_to_zone_id ?? ctx.zone_id;
    const zoneStaff = zoneAssignmentRepo.findStaffForZone(zoneId, ctx.now.toISOString());
    const hasServer = zoneStaff.some(s => s.role === 'server');

    if (!hasServer) {
      // No server on this zone right now — escalate to manager
      return 'manager';
    }
  }

  return draft.routed_to_role;
}

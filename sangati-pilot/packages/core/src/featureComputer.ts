/**
 * SANGATI Feature Computer
 *
 * Orchestrates the full pipeline for one session:
 *   1. Load session + events + baselines + existing alerts from DB
 *   2. Run deviation engine (pure computation)
 *   3. Write new alerts + decisions + updated features to DB
 *   4. Return list of new alerts (for WebSocket broadcast)
 */

import { v4 as uuid } from 'uuid';
import {
  sessionRepo,
  eventRepo,
  baselineRepo,
  alertRepo,
  decisionRepo,
  featureRepo,
  dbTransaction,
} from '@sangati/db';
import type { Alert } from '@sangati/shared';
import { computeDeviations } from './deviationEngine';
import { resolveRoutingRole } from './alertRouter';

export function processSession(sessionId: string, now = new Date()): Alert[] {
  const session = sessionRepo.findById(sessionId);
  if (!session || session.status === 'closed') return [];

  const events        = eventRepo.findBySession(sessionId);
  const baselines     = baselineRepo.findByVenueZone(session.venue_id, session.zone_id);
  const existingAlerts = alertRepo.findBySession(sessionId);

  const output = computeDeviations({ session, events, baselines, existingAlerts, now });

  const newAlerts: Alert[] = [];

  dbTransaction(() => {
    // Upsert features
    featureRepo.upsert({
      ...output.features,
      updated_at: now.toISOString(),
    });

    // Insert decisions
    for (const d of output.decisions) {
      decisionRepo.insert({
        id: uuid(),
        ...d,
        created_at: now.toISOString(),
      });
    }

    // Insert alerts (with routing resolution)
    for (const draft of output.alerts) {
      const routed_to_role = resolveRoutingRole(draft, {
        zone_id: session.zone_id,
        now,
      });

      const alert: Alert = {
        id: uuid(),
        ...draft,
        routed_to_role,
        created_at: now.toISOString(),
      };

      alertRepo.insert(alert);
      newAlerts.push(alert);
    }
  });

  return newAlerts;
}

/**
 * Run processSession for ALL active sessions.
 * Called by the periodic ticker.
 */
export function processAllActiveSessions(now = new Date()): Alert[] {
  const sessions = sessionRepo.findActive();
  const allNew: Alert[] = [];

  for (const session of sessions) {
    const fresh = processSession(session.id, now);
    allNew.push(...fresh);
  }

  return allNew;
}

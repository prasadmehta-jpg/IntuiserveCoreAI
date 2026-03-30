import { processAllActiveSessions } from '@sangati/core';
import { TICK_INTERVAL_MS } from '@sangati/shared';
import { broadcast } from './ws';

let tickerHandle: ReturnType<typeof setInterval> | null = null;

export function startTicker(): void {
  if (tickerHandle) return;

  console.log(`[ticker] Starting — interval ${TICK_INTERVAL_MS / 1000}s`);

  tickerHandle = setInterval(() => {
    try {
      const newAlerts = processAllActiveSessions(new Date());
      for (const alert of newAlerts) {
        broadcast('alert.created', alert);
      }
      if (newAlerts.length > 0) {
        console.log(`[ticker] ${newAlerts.length} new alert(s) generated`);
      }
    } catch (err) {
      console.error('[ticker] Error:', err);
    }
  }, TICK_INTERVAL_MS);
}

export function stopTicker(): void {
  if (tickerHandle) {
    clearInterval(tickerHandle);
    tickerHandle = null;
    console.log('[ticker] Stopped');
  }
}

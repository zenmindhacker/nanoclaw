/**
 * Register Slack history sync hooks into trunk router + wake lifecycle.
 */
import { getSession } from '../../db/sessions.js';
import { log } from '../../log.js';
import { registerInboundPreRouteHook, registerOnWakeHook } from '../../router.js';
import {
  exportSessionHistoryFiles,
  startSlackHistoryPeriodicSync,
  stopSlackHistoryPeriodicSync,
  syncSlackInboundPreRoute,
  startupSlackReconciliation,
} from './history-sync.js';

registerInboundPreRouteHook(async (mg, event) => {
  await syncSlackInboundPreRoute(mg, event);
});

registerOnWakeHook((ctx) => {
  if (ctx.event.channelType !== 'slack') return;
  const session = getSession(ctx.sessionId);
  if (session) exportSessionHistoryFiles(session);
});

export function initSlackHistorySync(): void {
  void startupSlackReconciliation().catch((err) => {
    log.warn('Slack history startup reconciliation failed', { err });
  });
  startSlackHistoryPeriodicSync();
}

export function teardownSlackHistorySync(): void {
  stopSlackHistoryPeriodicSync();
}

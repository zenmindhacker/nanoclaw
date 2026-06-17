/**
 * Fork extensions barrel — Cleo/Silas-specific host code.
 *
 * Upstream (nanocoai/nanoclaw) never edits src/extensions/**. Every file
 * in this directory is a deliberate fork customization. When merging
 * upstream, resolve src/index.ts conflicts by keeping this single import
 * line plus whatever startup steps upstream adds.
 *
 * See .nanoclaw/migrations/extensions.md for the full rationale.
 */

// Slack channel adapter — self-registers as 'slack' on import.
// This keeps src/channels/index.ts clean (upstream only has cli there).
import './slack/adapter.js';
// Open Slack assistant stream on container wake (Thinking Steps).
import './slack/on-wake.js';

import { deliverOAuthAlert } from './oauth/alerts.js';
import { startOAuthRefresher, stopOAuthRefresher } from './oauth/refresher.js';

export type { RefreshOptions, RefreshResult, TokenHealth } from './oauth/refresher.js';

/**
 * Start all fork extensions. Called from src/index.ts after the delivery
 * adapter is set up (so OAuth alerts can actually reach Slack).
 */
export function initExtensions(): void {
  startOAuthRefresher({
    onAlert: (message) => {
      void deliverOAuthAlert(message);
    },
  });
}

/** Stop all fork extensions. Called from shutdown(). */
export function teardownExtensions(): void {
  stopOAuthRefresher();
}

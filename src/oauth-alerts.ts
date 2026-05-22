/**
 * Deliver OAuth refresher alerts to the configured Slack sysops channel.
 */
import { OAUTH_ALERT_SLACK_CHANNEL } from './config.js';
import { getDeliveryAdapter } from './delivery.js';
import { log } from './log.js';

function parseSlackTarget(target: string): { channelType: string; platformId: string } {
  const trimmed = target.trim();
  if (trimmed.includes(':')) {
    const colon = trimmed.indexOf(':');
    return {
      channelType: trimmed.slice(0, colon),
      platformId: trimmed,
    };
  }
  return { channelType: 'slack', platformId: `slack:${trimmed}` };
}

/** Post a host OAuth alert to #sysops (best-effort). */
export async function deliverOAuthAlert(message: string): Promise<void> {
  const adapter = getDeliveryAdapter();
  if (!adapter) {
    log.warn('OAuth alert undelivered — delivery adapter not ready', { message });
    return;
  }

  const { channelType, platformId } = parseSlackTarget(OAUTH_ALERT_SLACK_CHANNEL);
  const stack = new Error().stack?.split('\n').slice(2, 5).map((l) => l.trim()).join(' | ') ?? '';
  log.info('deliverOAuthAlert called', { messageSnippet: message.slice(0, 80), stack });
  try {
    await adapter.deliver(channelType, platformId, null, 'chat-sdk', JSON.stringify({ text: `🔐 OAuth: ${message}` }));
    log.info('OAuth alert delivered', { channelType, platformId });
  } catch (err) {
    log.error('OAuth alert delivery failed', { channelType, platformId, err });
  }
}

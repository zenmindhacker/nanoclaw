/**
 * Open the Slack assistant stream when a session wakes.
 *
 * Registered into the router wake hook so trunk router.ts stays generic.
 */
import { getChannelAdapterExact } from '../../channels/channel-registry.js';
import { log } from '../../log.js';
import { registerOnWakeFailedHook, registerOnWakeHook, type WakeHookContext } from '../../router.js';

function startSlackSessionActivity(ctx: WakeHookContext): void {
  const channelAdapter = getChannelAdapterExact(ctx.mg.instance ?? ctx.event.channelType);
  if (!channelAdapter?.startSessionActivity) return;

  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(ctx.event.message.content) as Record<string, unknown>;
  } catch {
    /* keep empty meta */
  }
  if (ctx.event.message.isGroup !== undefined) {
    meta.isGroup = ctx.event.message.isGroup;
  }

  void channelAdapter
    .startSessionActivity(
      {
        sessionId: ctx.sessionId,
        agentGroupId: ctx.agentGroupId,
        channelType: ctx.deliveryAddr.channelType,
        platformId: ctx.deliveryAddr.platformId,
        threadId: ctx.deliveryAddr.threadId,
      },
      meta,
    )
    .catch((err) => log.debug('startSessionActivity failed', { sessionId: ctx.sessionId, err }));
}

function cancelSlackSessionActivity(ctx: WakeHookContext): void {
  const channelAdapter = getChannelAdapterExact(ctx.mg.instance ?? ctx.event.channelType);
  void channelAdapter?.cancelSessionActivity?.(ctx.sessionId);
}

registerOnWakeHook(startSlackSessionActivity);
registerOnWakeFailedHook(cancelSlackSessionActivity);

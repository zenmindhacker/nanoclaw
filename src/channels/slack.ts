/**
 * Slack channel adapter (v2) — uses Chat SDK bridge.
 * Self-registers on import.
 */
import https from 'node:https';

import { createSlackAdapter } from '@chat-adapter/slack';

import { readEnvFile } from '../env.js';
import { log } from '../log.js';
import { createChatSdkBridge } from './chat-sdk-bridge.js';
import { registerChannelAdapter } from './channel-registry.js';

let slackHttpTraceInstalled = false;

function traceSlackWebApiCall(source: string, url: string, body?: unknown): void {
  if (!url.includes('slack.com/api/chat.postMessage') && !url.includes('slack.com/api/chat.scheduleMessage')) {
    return;
  }
  const bodySnippet =
    typeof body === 'string' || body instanceof URLSearchParams
      ? String(body)
          .replace(/token=[^&\s]+/g, 'token=<redacted>')
          .slice(0, 240)
      : undefined;
  const stack =
    new Error().stack
      ?.split('\n')
      .slice(2, 9)
      .map((l) => l.trim())
      .join(' | ') ?? '';
  log.info('Slack Web API send', { source, url, bodySnippet, stack });
}

function requestUrlFromArgs(args: unknown[]): string {
  const first = args[0];
  if (typeof first === 'string' || first instanceof URL) return String(first);
  if (first && typeof first === 'object') {
    const options = first as { href?: string; protocol?: string; hostname?: string; host?: string; path?: string };
    if (options.href) return options.href;
    const host = options.hostname ?? options.host;
    if (host) return `${options.protocol ?? 'https:'}//${host}${options.path ?? ''}`;
  }
  return '';
}

function installSlackHttpTrace(): void {
  if (slackHttpTraceInstalled) return;
  slackHttpTraceInstalled = true;

  const originalFetch = globalThis.fetch?.bind(globalThis);
  if (originalFetch) {
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      traceSlackWebApiCall('fetch', url, init?.body);
      return originalFetch(input, init);
    };
  }

  const originalRequest = https.request.bind(https);
  https.request = ((...args: Parameters<typeof https.request>) => {
    traceSlackWebApiCall('https.request', requestUrlFromArgs(args));
    return originalRequest(...args);
  }) as typeof https.request;
}

registerChannelAdapter('slack', {
  factory: () => {
    const env = readEnvFile(['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET']);
    if (!env.SLACK_BOT_TOKEN) return null;
    installSlackHttpTrace();
    const slackAdapter = createSlackAdapter({
      botToken: env.SLACK_BOT_TOKEN,
      signingSecret: env.SLACK_SIGNING_SECRET,
    });
    const postMessage = slackAdapter.postMessage.bind(slackAdapter);
    slackAdapter.postMessage = async (threadId, message) => {
      const payload = message as { markdown?: string; text?: string; fallbackText?: string; card?: unknown };
      const textSnippet = String(
        payload.markdown ?? payload.text ?? payload.fallbackText ?? (payload.card ? '[card]' : ''),
      ).slice(0, 160);
      if (
        threadId.includes('C07F195GB96') ||
        textSnippet.includes('Failed to authenticate') ||
        textSnippet.includes('OAuth refresh failed')
      ) {
        const stack =
          new Error().stack
            ?.split('\n')
            .slice(2, 7)
            .map((l) => l.trim())
            .join(' | ') ?? '';
        log.info('Slack adapter postMessage', { threadId, textSnippet, stack });
      }
      return postMessage(threadId, message);
    };
    const bridge = createChatSdkBridge({
      adapter: slackAdapter,
      concurrency: 'concurrent',
      supportsThreads: true,
      transcribeAudioAttachments: true,
    });
    bridge.resolveChannelName = async (platformId: string) => {
      try {
        const info = await slackAdapter.fetchThread(platformId);
        return (info as { channelName?: string }).channelName ?? null;
      } catch {
        return null;
      }
    };
    return bridge;
  },
});

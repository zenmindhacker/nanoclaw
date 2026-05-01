import { Channel, NewMessage } from './types.js';
import { formatLocalTime } from './timezone.js';

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(
  messages: NewMessage[],
  timezone: string,
): string {
  const lines = messages.map((m) => {
    const displayTime = formatLocalTime(m.timestamp, timezone);
    const roleAttr = m.is_bot_message ? ' role="assistant"' : '';
    return `<message sender="${escapeXml(m.sender_name)}" time="${escapeXml(displayTime)}"${roleAttr}>${escapeXml(m.content)}</message>`;
  });

  const header = `<context timezone="${escapeXml(timezone)}" />\n`;

  return `${header}<messages>\n${lines.join('\n')}\n</messages>`;
}

/**
 * Format conversation with channel context preamble for new thread groups.
 * Includes recent channel messages so the agent knows what's being discussed.
 */
export function formatWithChannelContext(
  channelContext: NewMessage[],
  threadMessages: NewMessage[],
  timezone: string,
): string {
  const header = `<context timezone="${escapeXml(timezone)}" />\n`;
  const parts: string[] = [header];

  if (channelContext.length > 0) {
    const contextLines = channelContext.map((m) => {
      const displayTime = formatLocalTime(m.timestamp, timezone);
      const roleAttr = m.is_bot_message ? ' role="assistant"' : '';
      return `<message sender="${escapeXml(m.sender_name)}" time="${escapeXml(displayTime)}"${roleAttr}>${escapeXml(m.content)}</message>`;
    });
    parts.push(
      `<channel_context>\n${contextLines.join('\n')}\n</channel_context>`,
    );
  }

  const threadLines = threadMessages.map((m) => {
    const displayTime = formatLocalTime(m.timestamp, timezone);
    const roleAttr = m.is_bot_message ? ' role="assistant"' : '';
    return `<message sender="${escapeXml(m.sender_name)}" time="${escapeXml(displayTime)}"${roleAttr}>${escapeXml(m.content)}</message>`;
  });
  parts.push(`<messages>\n${threadLines.join('\n')}\n</messages>`);

  return parts.join('\n');
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

export function formatOutbound(rawText: string): string {
  const text = stripInternalTags(rawText);
  if (!text) return '';
  return text;
}

export function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  return channel.sendMessage(jid, text);
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}

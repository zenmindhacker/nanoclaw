/**
 * OpenCode Go chat completions — shared by matcher, confidentiality, and Linear extraction.
 * Production: OneCLI injects real credentials for opencode.ai via the container proxy.
 */

import { readFileSync } from 'fs';
import { OPENCODE_GO_BASE_URL, OPENROUTER_KEY_PATH } from './config.js';

export interface OpenCodeGoChatOptions {
  model: string;
  maxTokens: number;
  temperature?: number;
  fetchImpl?: typeof fetch;
}

export function getOpenCodeApiKey(): string {
  return process.env.OPENCODE_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENCODE_PROVIDER || 'opencode-go';
}

export function isOpenCodeGoModel(model: string): boolean {
  return model.startsWith('opencode-go/');
}

export function openCodeGoModelId(model: string): string {
  return model.replace(/^opencode-go\//, '');
}

export function getOpenRouterKey(): string | null {
  try {
    const key = readFileSync(OPENROUTER_KEY_PATH, 'utf-8').trim();
    return key || null;
  } catch {
    return null;
  }
}

/** Strip markdown code fences and return trimmed assistant text. */
export function extractAssistantContent(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

/**
 * Call OpenCode Go chat/completions. Returns assistant message text or null on failure.
 */
export async function completeOpenCodeGoChat(
  prompt: string,
  options: OpenCodeGoChatOptions,
): Promise<string | null> {
  const fetcher = options.fetchImpl || fetch;
  const temperature = options.temperature ?? 0;

  const response = await fetcher(`${OPENCODE_GO_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getOpenCodeApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: openCodeGoModelId(options.model),
      max_tokens: options.maxTokens,
      temperature,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenCode Go API error ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  return content || null;
}

/**
 * OpenRouter fallback when model id is not opencode-go/*.
 */
export async function completeOpenRouterChat(
  prompt: string,
  options: OpenCodeGoChatOptions,
): Promise<string | null> {
  const apiKey = getOpenRouterKey();
  if (!apiKey) return null;

  const fetcher = options.fetchImpl || fetch;
  const response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://nanoclaw.com',
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: options.maxTokens,
      temperature: options.temperature ?? 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim();
  return content || null;
}

export async function completeLlmChat(
  prompt: string,
  options: OpenCodeGoChatOptions,
): Promise<string | null> {
  if (isOpenCodeGoModel(options.model)) {
    return completeOpenCodeGoChat(prompt, options);
  }
  return completeOpenRouterChat(prompt, options);
}

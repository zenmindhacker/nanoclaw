/**
 * Confidentiality detection — checks transcripts for confidentiality triggers
 * and confirms with LLM when a trigger is found.
 */

import { CONFIDENTIALITY_TRIGGERS, LLM_CONFIDENTIALITY_MODEL, LLM_CONFIDENTIALITY_MAX_TOKENS } from './config.js';
import { completeLlmChat } from './opencode-go.js';
import { logWarn } from './logger.js';

export function hasConfidentialityTrigger(text: string): boolean {
  return CONFIDENTIALITY_TRIGGERS.test(text);
}

export async function confirmConfidentialWithLLM(transcript: string, title: string): Promise<boolean> {
  const sample = transcript.slice(0, 2000);
  const prompt = `Analyze this transcript excerpt. Did someone explicitly request confidentiality or ask not to record/share this conversation?

Title: ${title}
Excerpt:
${sample}

Respond with ONLY one word: CONFIDENTIAL or OK`;

  try {
    const result = await completeLlmChat(prompt, {
      model: LLM_CONFIDENTIALITY_MODEL,
      maxTokens: LLM_CONFIDENTIALITY_MAX_TOKENS,
      temperature: 0,
    });
    if (!result) return false;
    const lastLine = result.split('\n').pop() || '';
    return lastLine.toUpperCase().includes('CONFIDENTIAL');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`[confidential] LLM check failed, defaulting to OK: ${message}`);
    return false;
  }
}

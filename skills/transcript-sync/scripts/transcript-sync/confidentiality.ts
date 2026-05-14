/**
 * Confidentiality detection — checks transcripts for confidentiality triggers
 * and confirms with LLM when a trigger is found.
 */

import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { CONFIDENTIALITY_TRIGGERS } from './config.js';
import { logWarn } from './logger.js';

export function hasConfidentialityTrigger(text: string): boolean {
  return CONFIDENTIALITY_TRIGGERS.test(text);
}

export function confirmConfidentialWithLLM(transcript: string, title: string): boolean {
  const sample = transcript.slice(0, 2000);
  const prompt = `Analyze this transcript excerpt. Did someone explicitly request confidentiality or ask not to record/share this conversation?

Title: ${title}
Excerpt:
${sample}

Respond with ONLY one word: CONFIDENTIAL or OK`;

  const tmpFile = '/tmp/.confidential-check-prompt.txt';

  try {
    writeFileSync(tmpFile, prompt);
    const cmd = `claude --print "$(cat '${tmpFile}')" 2>&1`;
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 60000, shell: '/bin/bash' }).trim();
    const lastLine = result.split('\n').pop() || '';
    return lastLine.toUpperCase().includes('CONFIDENTIAL');
  } catch (error: any) {
    logWarn(`[confidential] LLM check failed, defaulting to OK: ${error.message}`);
    return false;
  }
}

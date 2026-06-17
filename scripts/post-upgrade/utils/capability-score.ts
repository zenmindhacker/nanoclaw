export type CapabilityScore = 'pass' | 'warn' | 'fail';

const DENIAL_PATTERNS = [
  "don't have persistent",
  'no persistent memory',
  "don't remember between",
  "don't remember everything",
  'each conversation is independent',
  "don't learn or grow",
  'training data is static',
  "i don't have memory",
  "i don't learn",
];

const AFFIRM_PATTERNS = [
  'mnemon',
  'wiki',
  'notes',
  'claude.local',
  'persistent memory',
  'save to',
  'saved to',
  'files you',
  'workspace',
  'self-mod',
  'customize',
  'check my notes',
];

export const CAPABILITY_PROMPT =
  'Do you have persistent memory between conversations? Answer in one or two sentences for your user. ' +
  'If yes, name how (notes, mnemon, wiki, or files you save). ' +
  'Do not claim you have no memory unless that is literally true for this install.';

export function scoreCapabilityReply(text: string): CapabilityScore {
  const lower = text.toLowerCase();
  const denies = DENIAL_PATTERNS.some((p) => lower.includes(p));
  const affirms = AFFIRM_PATTERNS.some((p) => lower.includes(p));
  if (denies && !affirms) return 'fail';
  if (affirms && !denies) return 'pass';
  if (affirms && denies) return 'warn';
  return 'warn';
}

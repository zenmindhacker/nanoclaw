/**
 * Injection pattern scanner for skill content.
 *
 * Ported from microclaw's memory_quality.rs scan_for_injection().
 * Blocks content that could manipulate agent behavior when injected
 * into the system prompt as a skill body.
 *
 * Called before any skill create/edit/patch write.
 */

/** Invisible unicode characters that can hide malicious instructions. */
const INVISIBLE_UNICODE_RE = /[\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/;

/** Instruction override patterns. */
const OVERRIDE_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|above|the)/i,
  /forget\s+(all\s+)?(previous|your)\s+(instructions?|training)/i,
  /you\s+are\s+now\s+(a\s+)?(?!cleo|silas|nanoclaw)/i, // "you are now a [different persona]"
];

/** Exfiltration patterns — curl/wget pointing at external hosts. */
const EXFILTRATION_RE = /(?:curl|wget)\s+[^|;$\n]{0,200}https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/i;

export interface ScanResult {
  ok: boolean;
  reason?: string;
}

export function scanForInjection(content: string): ScanResult {
  if (INVISIBLE_UNICODE_RE.test(content)) {
    return { ok: false, reason: 'content contains invisible unicode characters' };
  }

  for (const pattern of OVERRIDE_PATTERNS) {
    if (pattern.test(content)) {
      return { ok: false, reason: `instruction override pattern detected: ${pattern.source.slice(0, 60)}` };
    }
  }

  if (EXFILTRATION_RE.test(content)) {
    return { ok: false, reason: 'potential data exfiltration pattern (external curl/wget)' };
  }

  return { ok: true };
}

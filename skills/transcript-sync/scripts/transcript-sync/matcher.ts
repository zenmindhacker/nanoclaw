/**
 * Matcher — Stage 2 (candidate pairing) + Stage 3 (LLM classification).
 *
 * Stage 2: For each transcript, find candidate calendar events within a
 *          ±45 minute window. If exactly one candidate has attendees,
 *          auto-match (skip LLM).
 *
 * Stage 3: When auto-match fails (0 or 2+ candidates), call a cheap LLM
 *          to read the transcript excerpt + candidate events and return
 *          either a match index or an org classification.
 */

import { existsSync, readFileSync } from 'fs';
import {
  CALENDAR_WINDOW_MINUTES,
  OPENROUTER_KEY_PATH,
  LLM_CLASSIFIER_MODEL,
  LLM_CLASSIFIER_MAX_TOKENS,
  LLM_TRANSCRIPT_EXCERPT_CHARS,
  LLM_CLASSIFIER_CONFIDENCE_THRESHOLD,
} from './config.js';
import { logInfo, logWarn, logError, logDebug } from './logger.js';
import type { CalendarEvent, MatchResult } from './types.js';

// ============================================================================
// Stage 2: Candidate pairing
// ============================================================================

/**
 * Find calendar events whose time range overlaps with the transcript's
 * start time within ±windowMinutes. Returns candidates sorted by time
 * proximity (closest first).
 */
export function findCandidateEvents(
  transcriptStart: Date,
  allEvents: CalendarEvent[],
  windowMinutes: number = CALENDAR_WINDOW_MINUTES,
): CalendarEvent[] {
  const windowMs = windowMinutes * 60 * 1000;
  const tMin = transcriptStart.getTime() - windowMs;
  const tMax = transcriptStart.getTime() + windowMs;

  const candidates: Array<{ event: CalendarEvent; proximity: number }> = [];

  for (const ev of allEvents) {
    const evStartMs = ev.start.getTime();
    const evEndMs = ev.end.getTime();

    // Event overlaps with the window if:
    // - event starts within the window, OR
    // - event was already in progress when transcript started
    const startsInWindow = evStartMs >= tMin && evStartMs <= tMax;
    const inProgress = evStartMs <= transcriptStart.getTime() && evEndMs >= tMin;

    if (startsInWindow || inProgress) {
      const proximity = Math.abs(evStartMs - transcriptStart.getTime());
      candidates.push({ event: ev, proximity });
    }
  }

  // Sort by proximity (closest first)
  candidates.sort((a, b) => a.proximity - b.proximity);
  return candidates.map(c => c.event);
}

/**
 * Try to auto-match a transcript to a calendar event without LLM.
 * Succeeds when exactly one candidate has attendee data.
 */
export function tryAutoMatch(candidates: CalendarEvent[]): MatchResult | null {
  // Filter to candidates that have attendee data (meaningful for routing)
  const withAttendees = candidates.filter(
    ev => ev.attendees.filter(a => !a.isSelf).length > 0,
  );

  if (withAttendees.length === 1) {
    return {
      event: withAttendees[0],
      org: null,
      confidence: 0.9,
      method: 'auto',
      reason: `auto:single_candidate_with_attendees (of ${candidates.length} total)`,
    };
  }

  // If there are candidates but none with attendees, do NOT auto-match.
  // The event is in the right time window but has no attendee data for
  // routing. Let the LLM see the transcript + candidates and classify
  // the org directly — it's much better at this than blindly anchoring
  // to an attendee-less event.
  return null; // Need LLM
}

// ============================================================================
// Stage 3: LLM classification
// ============================================================================

const VALID_ORGS = [
  'ganttsy', 'ganttsy-strategy', 'ct', 'ctci', 'nvs',
  'personal', 'kevin', 'christina', 'mondo-zen', 'testboard',
];

function getOpenRouterKey(): string | null {
  if (!existsSync(OPENROUTER_KEY_PATH)) return null;
  try {
    return readFileSync(OPENROUTER_KEY_PATH, 'utf-8').trim();
  } catch {
    return null;
  }
}

function buildLLMPrompt(
  transcriptExcerpt: string,
  transcriptTitle: string,
  candidates: CalendarEvent[],
): string {
  const parts: string[] = [];

  parts.push('You are classifying a meeting transcript. Your job is to match it to a calendar event OR classify which organization it belongs to.');
  parts.push('');
  parts.push(`TRANSCRIPT TITLE (auto-generated, may not match calendar): "${transcriptTitle}"`);
  parts.push('');
  parts.push('TRANSCRIPT EXCERPT (first ~3000 chars):');
  parts.push(transcriptExcerpt);
  parts.push('');

  if (candidates.length > 0) {
    parts.push('CANDIDATE CALENDAR EVENTS (from the same time window):');
    for (let i = 0; i < candidates.length; i++) {
      const ev = candidates[i];
      const attendeeList = ev.attendees
        .filter(a => !a.isSelf)
        .map(a => a.email || a.name)
        .join(', ');
      parts.push(`${i + 1}. "${ev.title}" (${ev.start.toISOString()} - ${ev.end.toISOString()}, attendees: ${attendeeList || 'none listed'})`);
    }
    parts.push('');
  } else {
    parts.push('No candidate calendar events found in the time window.');
    parts.push('');
  }

  parts.push('ORGANIZATIONS:');
  parts.push('- ganttsy: Ganttsy product team meetings (software dev, demos, standups)');
  parts.push('- ganttsy-strategy: Ganttsy 1:1s, strategy, hiring, business');
  parts.push('- ct: CopperTeams product/engineering meetings');
  parts.push('- ctci: Cognitive Tech consulting (default for unknown clients)');
  parts.push('- nvs: New Value Solutions / Telus work');
  parts.push('- personal: Personal calls, no business context');
  parts.push('- kevin: Coaching sessions with Kevin Lee');
  parts.push('- christina: Coaching sessions with Christina Lane');
  parts.push('- mondo-zen: Mondo Zen / Shining Bright Lotus / FMZF');
  parts.push('- testboard: Testboard client meetings');
  parts.push('');

  if (candidates.length > 0) {
    parts.push('Reply with ONLY valid JSON (no markdown, no explanation):');
    parts.push('If the transcript matches a calendar event: {"match": <1-indexed number>, "confidence": <0.0-1.0>}');
    parts.push('If no event matches, classify the org: {"match": null, "org": "<org>", "confidence": <0.0-1.0>}');
  } else {
    parts.push('Reply with ONLY valid JSON (no markdown, no explanation):');
    parts.push('{"match": null, "org": "<org>", "confidence": <0.0-1.0>}');
  }

  return parts.join('\n');
}

interface LLMResponse {
  match: number | null;
  org?: string;
  confidence: number;
}

async function callLLM(prompt: string): Promise<LLMResponse | null> {
  const apiKey = getOpenRouterKey();
  if (!apiKey) {
    logWarn('[matcher] OpenRouter key not found, LLM classification unavailable');
    return null;
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://nanoclaw.com',
      },
      body: JSON.stringify({
        model: LLM_CLASSIFIER_MODEL,
        max_tokens: LLM_CLASSIFIER_MAX_TOKENS,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logError(`[matcher] LLM API error ${response.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      logWarn('[matcher] LLM returned empty content');
      return null;
    }

    logDebug(`[matcher] LLM raw response: ${content}`);

    // Parse JSON from response — handle markdown code fences
    let jsonStr = content;
    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as LLMResponse;

    // Validate
    if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
      logWarn(`[matcher] LLM returned invalid confidence: ${parsed.confidence}`);
      return null;
    }
    if (parsed.match !== null && (typeof parsed.match !== 'number' || parsed.match < 1)) {
      logWarn(`[matcher] LLM returned invalid match index: ${parsed.match}`);
      return null;
    }
    if (parsed.org && !VALID_ORGS.includes(parsed.org)) {
      logWarn(`[matcher] LLM returned invalid org: ${parsed.org}`);
      return null;
    }

    return parsed;
  } catch (err: any) {
    logError(`[matcher] LLM call failed: ${err.message}`);
    return null;
  }
}

/**
 * Run the full matching pipeline for a single transcript.
 *
 * 1. Find candidate calendar events (Stage 2)
 * 2. Try auto-match
 * 3. If auto-match fails, call LLM (Stage 3)
 * 4. Return MatchResult
 */
export async function matchTranscript(
  transcriptStart: Date,
  transcriptTitle: string,
  transcriptExcerpt: string,
  allEvents: CalendarEvent[],
): Promise<MatchResult> {
  // Stage 2: Find candidates
  const candidates = findCandidateEvents(transcriptStart, allEvents);
  logInfo(`[matcher] ${transcriptTitle.slice(0, 60)} — ${candidates.length} candidate(s) in ±${CALENDAR_WINDOW_MINUTES}min window`);

  // Try auto-match first
  const autoResult = tryAutoMatch(candidates);
  if (autoResult) {
    logInfo(`[matcher] Auto-matched → "${autoResult.event!.title}" (${autoResult.reason})`);
    return autoResult;
  }

  // Stage 3: LLM classification
  const excerpt = transcriptExcerpt.slice(0, LLM_TRANSCRIPT_EXCERPT_CHARS);
  const prompt = buildLLMPrompt(excerpt, transcriptTitle, candidates);
  const llmResult = await callLLM(prompt);

  if (!llmResult) {
    // LLM unavailable — fall through to unmatched
    return {
      event: candidates.length > 0 ? candidates[0] : null,
      org: null,
      confidence: 0,
      method: 'none',
      reason: 'llm_unavailable',
    };
  }

  // LLM matched to a calendar event
  if (llmResult.match !== null) {
    const idx = llmResult.match - 1; // 1-indexed → 0-indexed
    if (idx >= 0 && idx < candidates.length) {
      const matched = candidates[idx];
      if (llmResult.confidence >= LLM_CLASSIFIER_CONFIDENCE_THRESHOLD) {
        logInfo(`[matcher] LLM matched → "${matched.title}" (confidence=${llmResult.confidence})`);
        return {
          event: matched,
          org: null,
          confidence: llmResult.confidence,
          method: 'llm',
          reason: `llm:matched_event_${llmResult.match}_of_${candidates.length}`,
        };
      }
      logWarn(`[matcher] LLM match confidence too low: ${llmResult.confidence} < ${LLM_CLASSIFIER_CONFIDENCE_THRESHOLD}`);
    } else {
      logWarn(`[matcher] LLM returned out-of-range match index: ${llmResult.match}`);
    }
  }

  // LLM classified to an org (no calendar match)
  if (llmResult.org) {
    if (llmResult.confidence >= LLM_CLASSIFIER_CONFIDENCE_THRESHOLD) {
      logInfo(`[matcher] LLM classified → org=${llmResult.org} (confidence=${llmResult.confidence})`);
      return {
        event: null,
        org: llmResult.org,
        confidence: llmResult.confidence,
        method: 'llm',
        reason: `llm:org_${llmResult.org}`,
      };
    }
    logWarn(`[matcher] LLM org confidence too low: ${llmResult.confidence} < ${LLM_CLASSIFIER_CONFIDENCE_THRESHOLD}`);
  }

  // LLM returned something but below threshold
  return {
    event: candidates.length > 0 ? candidates[0] : null,
    org: llmResult.org || null,
    confidence: llmResult.confidence,
    method: 'none',
    reason: `llm_low_confidence:${llmResult.confidence}`,
  };
}

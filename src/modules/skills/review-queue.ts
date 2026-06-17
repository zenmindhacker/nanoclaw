/**
 * End-of-turn skill review queue — Tier 3 of the Phase 5 skill lifecycle.
 *
 * Ported from microclaw's skill_review.rs SkillReviewQueue + agent_engine.rs
 * trigger logic. After a turn with enough tool calls, queues a background
 * LLM review using a cheap worker model (OpenCode Go deepseek-v4-flash).
 *
 * Architecture:
 *   1. Host receives outbound turn summary from container
 *   2. assessSuccess() gates the review
 *   3. A delegate-style worker LLM reviews the tool trajectory
 *   4. Verdict is staged as a pending_approval (or auto-applied for safe patches)
 *
 * NOTE: This is the design skeleton. The LLM call is a stub until the
 * OpenCode Go delegate endpoint is confirmed working from the host process.
 * See docs/skill-lifecycle.md §Tier 3 for the full spec.
 */
import { log } from '../../log.js';

export const SKILL_REVIEW_MIN_TOOL_CALLS = 5;

export type ReviewVerdict = 'create' | 'edit' | 'patch' | 'none';

export interface ReviewRequest {
  sessionId: string;
  agentGroupId: string;
  folder: string;
  toolCallCount: number;
  toolTrajectory: string; // serialized tool call + result summary
  finalText: string;
}

export interface ReviewResult {
  action: ReviewVerdict;
  skill_name?: string;
  description?: string;
  reason?: string;
  content?: string; // For create/edit: full SKILL.md body
  search_text?: string; // For patch: exact match target
  replace_text?: string; // For patch: replacement
}

/**
 * Assess whether a turn is worth reviewing for skill distillation.
 * Ported from microclaw skill_review.rs `assess_success()`.
 */
export function assessSuccess(toolCallCount: number, toolErrorRate: number, finalText: string): boolean {
  if (toolCallCount < SKILL_REVIEW_MIN_TOOL_CALLS) return false;
  if (toolErrorRate > 0.5) return false; // > 50% tool errors → not worth reviewing
  if (!finalText || finalText.trim().length === 0) return false;

  // Apology/circuit-breaker phrases indicate a failed or incomplete turn.
  const FAILURE_PHRASES = [
    "i'm sorry",
    'i apologize',
    'i was unable',
    'i failed',
    'something went wrong',
    'i encountered an error',
    'i cannot',
    "i can't",
  ];
  const lower = finalText.toLowerCase();
  if (FAILURE_PHRASES.some((p) => lower.includes(p))) return false;

  return true;
}

// In-memory queue — one entry per session awaiting review.
const queue = new Map<string, ReviewRequest>();

/** Enqueue a turn for background skill review. Idempotent per session. */
export function enqueueReview(req: ReviewRequest): void {
  if (!assessSuccess(req.toolCallCount, 0, req.finalText)) return;
  if (queue.has(req.sessionId)) return; // Already queued for this session.
  queue.set(req.sessionId, req);
  log.debug('Skill review queued', { sessionId: req.sessionId, toolCallCount: req.toolCallCount });
}

/** Drain the review queue, calling the LLM for each entry. */
export async function drainReviewQueue(): Promise<void> {
  if (queue.size === 0) return;
  const entries = [...queue.entries()];
  queue.clear();

  for (const [sessionId, req] of entries) {
    try {
      await reviewTurn(req);
    } catch (err) {
      log.warn('Skill review failed', { sessionId, err });
    }
  }
}

/**
 * Run a skill review for one turn.
 * Stub: LLM call returns 'none' until the host-side delegate endpoint is wired.
 */
async function reviewTurn(req: ReviewRequest): Promise<void> {
  log.debug('Reviewing turn for skill distillation (stub)', {
    sessionId: req.sessionId,
    folder: req.folder,
    toolCalls: req.toolCallCount,
  });

  // TODO: Call OpenCode Go delegate API with the tool trajectory.
  // Until wired, this stub always returns 'none' to avoid accidental skill writes.
  const verdict: ReviewResult = { action: 'none', reason: 'stub: LLM delegate not yet wired' };

  if (verdict.action === 'none') return;

  log.info('Skill review verdict', {
    sessionId: req.sessionId,
    action: verdict.action,
    skill: verdict.skill_name,
    reason: verdict.reason,
  });

  // TODO: Call src/modules/skills/apply.ts to write the skill (or stage for approval).
}

/**
 * State management for transcript-sync
 * Handles loading and saving sync state (watermarks, skipped items)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { STATE_PATH } from './config.js';
import { logInfo, logWarn } from './logger.js';
import type { State } from './types.js';

const DEFAULT_STATE: State = {
  lastConvIdx: 0,
  lastFathomCreatedAt: null,
  lastGanttsyWorkspaceModifiedTime: null,
  skippedConvs: [],
  skippedFathomIds: [],
  skippedGanttsyWorkspaceIds: [],
};

export function loadState(): State {
  if (!existsSync(STATE_PATH)) {
    logInfo('[state] No existing state file, using defaults');
    return { ...DEFAULT_STATE };
  }

  try {
    const raw = readFileSync(STATE_PATH, 'utf-8');
    const state = JSON.parse(raw) as Partial<State>;
    return {
      ...DEFAULT_STATE,
      ...state,
    };
  } catch (error: any) {
    logWarn(`[state] Failed to load state: ${error.message}, using defaults`);
    return { ...DEFAULT_STATE };
  }
}

export function saveState(state: State): void {
  try {
    const dir = dirname(STATE_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
    logInfo('[state] State saved');
  } catch (error: any) {
    logWarn(`[state] Failed to save state: ${error.message}`);
  }
}

export function markConversationSkipped(state: State, convIdx: number): void {
  if (!state.skippedConvs) {
    state.skippedConvs = [];
  }
  if (!state.skippedConvs.includes(convIdx)) {
    state.skippedConvs.push(convIdx);
  }
}

export function markFathomSkipped(state: State, recordingId: string): void {
  if (!state.skippedFathomIds) {
    state.skippedFathomIds = [];
  }
  if (!state.skippedFathomIds.includes(recordingId)) {
    state.skippedFathomIds.push(recordingId);
  }
}

export function markGanttsyWorkspaceSkipped(state: State, docId: string): void {
  if (!state.skippedGanttsyWorkspaceIds) {
    state.skippedGanttsyWorkspaceIds = [];
  }
  if (!state.skippedGanttsyWorkspaceIds.includes(docId)) {
    state.skippedGanttsyWorkspaceIds.push(docId);
  }
}

#!/usr/bin/env node
/**
 * transcript-sync - Main entry point
 *
 * Syncs transcripts from multiple sources (Shadow, Google Workspace)
 * to appropriate GitHub repositories based on attendee/content classification.
 *
 * Modular structure:
 * - config.ts: Centralized configuration
 * - types.ts: Type definitions
 * - logger.ts: Logging utilities
 * - state.ts: State management
 * - coaching.ts: Coaching analysis spawning
 * - helpers.ts: Shared utilities (slugify, mergeAttendees)
 * - calendar.ts: Google Calendar service and attendee fallback
 * - classification.ts: Transcript routing rules
 * - confidentiality.ts: Confidentiality detection
 * - dedup.ts: Cross-source deduplication
 * - pending-actions.ts: Human-in-the-loop action item approval
 * - sources/shadow.ts: Shadow SQLite source
 * - sources/ganttsy.ts: Ganttsy Google Workspace source
 */

export * from './config.js';
export * from './types.js';
export * from './logger.js';
export * from './state.js';
export * from './coaching.js';
export * from './helpers.js';
export * from './calendar.js';
export * from './classification.js';
export * from './confidentiality.js';
export * from './dedup.js';
export * from './pending-actions.js';
export * from './sources/shadow.js';
export * from './sources/ganttsy.js';

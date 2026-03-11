#!/usr/bin/env node
/**
 * transcript-sync - Main entry point
 * 
 * Syncs transcripts from multiple sources (Shadow, Fathom, Google Workspace)
 * to appropriate GitHub repositories based on attendee/content classification.
 * 
 * Refactored modular structure:
 * - config.ts: Centralized configuration
 * - types.ts: Type definitions
 * - logger.ts: Logging utilities
 * - state.ts: State management
 * - coaching.ts: Coaching analysis spawning
 * - sources/: Source-specific fetchers (shadow, fathom, ganttsy)
 * - routing/: Classification and routing logic
 */

// Re-export the main script for now
// TODO: Migrate main() logic here incrementally
export * from './config.js';
export * from './types.js';
export * from './logger.js';
export * from './state.js';
export * from './coaching.js';

// For now, the main entry point remains transcript-sync.ts
// This file serves as the module index for imports
console.log('transcript-sync modules loaded');

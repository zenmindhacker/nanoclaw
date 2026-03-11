/**
 * Logging utilities for transcript-sync
 */

import { appendFileSync } from 'fs';
import { LOG_FILE } from './config.js';

export type LogLevel = 'INFO' | 'ERROR' | 'WARN' | 'DEBUG';

export function log(level: LogLevel, message: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${message}\n`;
  process.stdout.write(line);
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // ignore append failures
  }
}

export function logInfo(msg: string): void {
  log('INFO', msg);
}

export function logError(msg: string): void {
  log('ERROR', msg);
}

export function logWarn(msg: string): void {
  log('WARN', msg);
}

export function logDebug(msg: string): void {
  if (process.env.DEBUG) {
    log('DEBUG', msg);
  }
}

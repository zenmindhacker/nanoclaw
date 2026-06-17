import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/** NanoClaw container mount (read-only Shadow app data) */
export const CONTAINER_SHADOW_DB = '/workspace/extra/shadow/shadow.db';

/** macOS Shadow recorder default */
export const MACOS_SHADOW_DB = join(
  homedir(),
  'Library/Application Support/com.taperlabs.shadow/shadow.db',
);

function resolveShadowDbPath() {
  if (process.env.SHADOW_DB_PATH) return process.env.SHADOW_DB_PATH;
  if (existsSync(CONTAINER_SHADOW_DB)) return CONTAINER_SHADOW_DB;
  return MACOS_SHADOW_DB;
}

export const SHADOW_DB_PATH = resolveShadowDbPath();

export const TRANS_STATUS_COMPLETE = 3;

export const SELF_EMAILS = [
  'cian@cognitivetech.net',
  'cian@ganttsy.com',
  'cian@copperteams.ai',
  'cian.whalley@newvaluegroup.com',
  'cwhalley@gmail.com',
];

export const CT_SHARED_CALENDAR_ID =
  'c_ed7a5f763561bf4de136dac98759d2e01875cb730c61b5f4a3308654d5c54941@group.calendar.google.com';

/** Writable output dir inside NanoClaw containers */
export const CONTAINER_OUTPUT_DIR = '/workspace/group/transcript-search';

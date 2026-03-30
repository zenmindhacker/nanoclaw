/**
 * Configuration for transcript-sync
 * Container-aware paths — all paths use /workspace/ prefixes for NanoClaw containers.
 */

// Container mount roots (env var overrides for host-side testing)
export const GITHUB_ROOT = process.env.GITHUB_ROOT || '/workspace/extra/github';
export const CREDENTIALS_ROOT = process.env.CREDENTIALS_ROOT || '/workspace/extra/credentials';
export const SKILLS_ROOT = process.env.SKILLS_ROOT || '/workspace/extra/skills';

// Group writable workspace (persists across runs)
export const GROUP_WORKSPACE = process.env.GROUP_WORKSPACE || '/workspace/group/transcript-sync';

// Shadow (local transcription app — mounted read-only)
export const SHADOW_DB_PATH = process.env.SHADOW_DB_PATH || '/workspace/extra/shadow/shadow.db';

// State management
export const STATE_PATH = `${GROUP_WORKSPACE}/transcript-sync-state.json`;

// Logging
export const LOG_FILE = `${GROUP_WORKSPACE}/transcript-sync.log`;

// Coaching repository
export const COACHING_ROOT = `${GITHUB_ROOT}/cognitivetech/coaching`;
export const KEVIN_COACHING_TRANSCRIPTS = `${COACHING_ROOT}/kevin/transcripts`;
export const CHRISTINA_COACHING_TRANSCRIPTS = `${COACHING_ROOT}/christina/transcripts`;
export const MONDO_ZEN_COACHING_TRANSCRIPTS = `${COACHING_ROOT}/mondo-zen/transcripts`;
export const COACH_ANALYSIS_ROOT = `${COACHING_ROOT}/coach-analysis`;
export const PROCESSED_TRANSCRIPTS_PATH = `${COACH_ANALYSIS_ROOT}/.processed-transcripts.json`;

// Personal transcripts
export const PERSONAL_TRANSCRIPTS = `${GITHUB_ROOT}/personal/transcripts`;

// Testboard (discovery / new client under CTCI)
export const TESTBOARD_TRANSCRIPTS = `${GITHUB_ROOT}/cognitivetech/ctci-docs/transcripts/testboard`;

// Coaching skills
export const COACHING_SKILL_CLIENT = `${COACHING_ROOT}/.agents/skills/client-analysis/SKILL.md`;
export const COACHING_SKILL_COACH = `${COACHING_ROOT}/.agents/skills/coach-analysis/SKILL.md`;

// Google OAuth credentials (shadow calendar matching)
export const GOOGLE_TOKEN = `${CREDENTIALS_ROOT}/shadow-google-token.json`;
export const GOOGLE_OAUTH_CLIENT = `${CREDENTIALS_ROOT}/shadow-google-oauth-client.json`;

// Ganttsy workspace (Google Drive folder for meeting transcripts)
export const GANTTSY_WORKSPACE_FOLDER = '1gRFJ45HMM0ebyjqFxmAdlXa-oHklYT0G';
export const GANTTSY_GOOGLE_TOKEN = `${CREDENTIALS_ROOT}/ganttsy-google-token.json`;
export const GANTTSY_GOOGLE_OAUTH_CLIENT = `${CREDENTIALS_ROOT}/ganttsy-google-oauth-client.json`;

// OpenRouter (for LLM action extraction)
export const OPENROUTER_KEY_PATH = `${CREDENTIALS_ROOT}/openrouter`;

// Linear integration
export const TRANSCRIPT_TASKS_SCRIPT = `${SKILLS_ROOT}/transcript-sync/scripts/transcript-to-linear-llm.ts`;

// Transcript routing destinations
export const TRANSCRIPT_DESTINATIONS = {
  ganttsy: {
    docs: `${GITHUB_ROOT}/ganttsy/ganttsy-docs/transcripts`,
    strategy: `${GITHUB_ROOT}/ganttsy/ganttsy-strategy/transcripts`,
  },
  copperteams: `${GITHUB_ROOT}/copperteams/ct-docs/planning/transcripts`,
  cognitivetech: `${GITHUB_ROOT}/cognitivetech/ctci-docs/transcripts`,
  nvs: `${GITHUB_ROOT}/nvs/nvs-docs/transcripts`,
  coaching: {
    kevin: KEVIN_COACHING_TRANSCRIPTS,
    christina: CHRISTINA_COACHING_TRANSCRIPTS,
    mondoZen: MONDO_ZEN_COACHING_TRANSCRIPTS,
  },
  personal: PERSONAL_TRANSCRIPTS,
  testboard: TESTBOARD_TRANSCRIPTS,
} as const;

// Default calendar IDs for meeting matching
export const DEFAULT_CALENDAR_IDS = [
  'cian@cognitivetech.net',
  'cian@copperteams.ai',
  'cian@ganttsy.com',
  'c_ed7a5f763561bf4de136dac98759d2e01875cb730c61b5f4a3308654d5c54941@group.calendar.google.com',
];

// Self-identification emails (for attendee detection)
export const SELF_EMAILS = [
  'cian@cognitivetech.net',
  'cian@ganttsy.com',
  'cian@copperteams.ai',
  'cian.whalley@newvaluegroup.com',
  'cwhalley@gmail.com',
];

// Confidentiality detection
export const CONFIDENTIALITY_TRIGGERS = /\b(confidential|private|off[\s-]?the[\s-]?record|don'?t\s+record|not\s+for\s+recording|keep\s+this\s+between\s+us|turn\s+off\s+(the\s+)?transcript|(take|turn)\s+(the\s+)?transcripts?(ions?)?\s+off)/i;

// Processing limits
export const DEFAULT_LIMIT = 50;
export const MIN_TRANSCRIPT_ROWS = 10;
export const MIN_ENDED_AGO_MS = 5 * 60 * 1000; // 5 minutes
export const DEDUP_TIME_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const CALENDAR_WINDOW_MINUTES = 10;

// Agent configuration
export const COACHING_AGENT_TIMEOUT_SECONDS = 600;
export const COACHING_AGENT_THINKING_LEVEL = 'medium';

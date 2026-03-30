# Transcript Sync System

**Purpose**: Automatically fetch and process meeting transcripts from multiple sources (Shadow, Fathom, Google Workspace) and route them to appropriate GitHub repositories.

## Architecture

### Scheduling
- **Manager**: OpenClaw cron (pure openclaw approach)
- **Job ID**: `e6945d83-1028-40da-b390-9c5b42730312`
- **Schedule**: Every 10 minutes
- **Command**: `tsx transcript-sync.ts --limit 50 --calendar-fallback ...`

View status:
```bash
openclaw cron list
```

Trigger manually:
```bash
openclaw cron run e6945d83-1028-40da-b390-9c5b42730312
```

### Processing Flow
1. **Fetch** transcripts from sources (Shadow DB, Fathom API, Google Drive)
2. **Deduplicate** by gcal_event_id and time windows
3. **Classify** meetings by attendees/content
4. **Route** to appropriate repos
5. **Spawn coaching analysis** for coaching transcripts (via openclaw cron one-shot jobs)
6. **Validate** previous runs for incomplete analysis
7. **Update state** watermarks

### Modular Structure
```
transcript-sync/
├── config.ts      # Centralized paths and settings
├── types.ts       # TypeScript interfaces
├── logger.ts      # Logging utilities
├── state.ts       # State persistence
├── coaching.ts    # Coaching analysis spawning
└── index.ts       # Module exports
```

Main script: `../transcript-sync.ts` (1700+ lines, uses modules)

## Key Features

### Self-Healing Validation
On each run, `validateCoachingAnalysis()` checks that transcripts marked as processed actually have output files:
- `coach-analysis/<client>/session-insights/YYYY-MM-DD-*.md`
- `coach-analysis/<client>/methodology/YYYY-MM-DD-*.md`

Missing files trigger automatic re-analysis.

### Agent Spawning (Hybrid Model Approach)
Coaching analysis uses **two-tier model strategy** for cost optimization:

**Tier 1: Orchestrator (MiniMax M2.5)**
- Runs via `openclaw cron add --at now --agent main --model minimax`
- Reads transcripts and skill docs
- Plans the analysis structure
- Validates outputs
- Updates processed-transcripts.json
- **Cost**: ~$0.045 per 50k tokens

**Tier 2: Writer (Opus 4-6)**
- Spawned by orchestrator via `claude --task "..." --agent writer`
- Creates all markdown files (session-insights, methodology, etc.)
- High-quality analysis and writing
- **Cost**: Only charged for actual content creation

**Total savings**: ~97% compared to running full session in Opus

Command:
```bash
openclaw cron add \
  --name coaching-analysis-... \
  --at now \
  --agent main \
  --model openrouter/minimax/minimax-m2.5 \
  --timeout-seconds 600 \
  --delete-after-run \
  --message '...'
```

### Deduplication
- Cross-source: Same gcal_event_id from different sources
- Time-based: Meetings within 15min window with matching attendees
- Historical: Scans last 7 days of transcript files

### Routing Logic
Classifies meetings by attendee emails:
- **Coaching**: kevin@... → `coaching/kevin/transcripts/`
- **Coaching**: christina@... → `coaching/christina/transcripts/`
- **Ganttsy**: @ganttsy.com → `ganttsy/ganttsy-docs/transcripts/`
- **CopperTeams**: ct-specific → `copperteams/ct-docs/planning/transcripts/`
- **NVS**: nvs-specific → `nvs/nvs-docs/transcripts/`
- **Default**: → `cognitivetech/transcripts/`

## Logs

| Log | Path |
|-----|------|
| Main script | `/Users/cian/.openclaw/logs/transcript-sync.log` |
| Stdout (from LaunchAgent, now unused) | `/Users/cian/.openclaw/logs/transcript-sync.stdout.log` |
| Stderr (from LaunchAgent, now unused) | `/Users/cian/.openclaw/logs/transcript-sync.error.log` |
| Coaching agents | `/Users/cian/.openclaw/agents/main/sessions/coaching-analysis-*.jsonl` |

## State Files

| File | Purpose |
|------|---------|
| `state/transcript-sync-state.json` | Watermarks (last processed IDs/timestamps) |
| `coaching/coach-analysis/.processed-transcripts.json` | Coaching analysis tracking |

## Migration from LaunchAgent

**Previous**: macOS LaunchAgent (`com.openclaw.transcript-sync.plist`)  
**Current**: OpenClaw cron (`transcript-sync-every-10min`)

**Why**: Unified management, better tracking, consistent tooling

LaunchAgent disabled:
```bash
# Backed up to .disabled
/Users/cian/Library/LaunchAgents/com.openclaw.transcript-sync.plist.disabled
```

## Troubleshooting

**Script not running**:
```bash
openclaw cron list | grep transcript-sync
# Should show: status=ok, last run recent
```

**No new meetings processed**:
Check logs for deduplication messages. May need to adjust watermarks in state file.

**Coaching analysis incomplete**:
Validation runs on each cycle. Check logs for `[validation]` messages. Missing files trigger automatic re-queue.

**Agent spawning fails**:
Script falls back to shell background process. Check for `[coaching] Falling back` in logs.

## Development

Run manually:
```bash
cd /Users/cian/.openclaw/workspace
tsx scripts/transcript-sync.ts --dry-run --report-only
```

Test with recent data:
```bash
tsx scripts/transcript-sync.ts --since-days 7 --limit 10
```

Disable auto-processing:
```bash
openclaw cron disable e6945d83-1028-40da-b390-9c5b42730312
```

Re-enable:
```bash
openclaw cron enable e6945d83-1028-40da-b390-9c5b42730312
```

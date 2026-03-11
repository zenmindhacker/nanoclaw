# ganttsy-resume

Fetch, parse, and rank resumes sent to **careers@ganttsy.com**. Downloads new attachments from Gmail, converts to markdown, extracts metadata, scores against the Product Designer job posting, and updates the evaluation grid in the Ganttsy strategy repo.

## Location
`{baseDir} = ~/.openclaw/workspace/skills/ganttsy-resume`

```
{baseDir}/
├── SKILL.md
├── scripts/
│   ├── fetch-resumes.sh
│   ├── parse-resumes.sh
│   ├── rank-resumes.js
│   ├── sync-drive.sh
│   └── run-daily.sh
├── candidates/
│   ├── raw/
│   └── md/
└── .state/
    ├── processed_ids.txt
    └── last_report.json
```

## Requirements
- `jq`
- `curl`
- For PDF parsing: `pdftotext` (preferred) or `pdfplumber`
- For DOCX parsing: `pandoc` or `textutil`
- Node.js (for `rank-resumes.js`)

OAuth token file (already configured):
- `~/.openclaw/credentials/ganttsy-google-token.json`

## Usage

### 1) Fetch new resumes
```
{baseDir}/scripts/fetch-resumes.sh
```
- Searches Gmail with: `to:careers@ganttsx.com has:attachment` (override via `QUERY=...`)
- Downloads new PDF/DOCX attachments into `{baseDir}/candidates/raw/`
- Tracks processed message IDs in `{baseDir}/.state/processed_ids.txt`

### 2) Parse resumes into markdown + metadata
```
{baseDir}/scripts/parse-resumes.sh
```
- Converts PDFs/DOCX to markdown-ish text
- Writes `{baseDir}/candidates/md/*.md` and `*.json` with name/email/experience/skills

### 3) Rank resumes
```
node {baseDir}/scripts/rank-resumes.js
```
- Scores candidates against `JOB-POSTING-Product-Designer.md`
- Updates `EVALUATION-GRID.md` with an auto-generated table

### 4) Full daily run
```
{baseDir}/scripts/run-daily.sh
```
- Runs fetch → parse → rank
- Syncs outputs into the target repo folder
- Commits + pushes to GitHub
- Outputs summary + report JSON

## Target Repo
Default target folder (override with `TARGET_DIR`):
```
/Users/cian/Documents/GitHub/ganttsy/ganttsy-strategy/team/designer-resumes/
```
Artifacts are synced to:
```
{target}/candidates/raw/
{target}/candidates/md/
```

## Cron (to be set up by main agent)
Daily at **6am America/Costa_Rica** (6:00 CST), isolated session, announce mode.

Example (pseudo, in `HEARTBEAT.md` or OpenClaw scheduler):
```
openclaw cron add \
  --name ganttsy-resume-daily \
  --schedule "0 6 * * *" \
  --sessionTarget isolated \
  --wakeMode next-heartbeat \
  --command "{baseDir}/scripts/run-daily.sh"
```

## Notes
- Idempotent: processed Gmail message IDs are tracked.
- If `pdftotext` isn’t available, install poppler or use `pdfplumber`.
- If no git changes are found, `sync-drive.sh` exits gracefully.

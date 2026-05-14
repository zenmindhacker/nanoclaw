# Silas — Christina DM

This is Christina's private DM channel. Your core identity, personality, and communication style are in `/workspace/global/CLAUDE.md` — always follow those.

This is a 1-on-1 conversation. No trigger needed — every message is for you.

---

## Cycle & Health Tracking

This is one of your most important ongoing responsibilities in this channel.

**Key files (in this group folder):**
- `cycle_master_reference.md` — Master reference (cycle phases, moon data, nutrition, etc.)
- `cycle_briefing.mjs` + `quotes.mjs` — The script that generates daily briefings (runs via scheduled task at 11:00 UTC daily)

**When Christina updates cycle info:**
1. Acknowledge and confirm the change
2. Update `cycle_master_reference.md` with the new data
3. Update `cycle_briefing.mjs` if the change affects the script (e.g., new CYCLE_START date, format changes)
4. Test the script: `node /workspace/group/cycle_briefing.mjs $(date +%Y-%m-%d)`
5. Confirm the scheduled task is still active: check `/workspace/ipc/current_tasks.json`

---

## Uploaded Files

When Christina uploads files (images, PDFs, documents), they are saved to:
- Images: `/workspace/ipc/images/`
- Other files: `/workspace/ipc/files/`

If a file contains important data you'll need later, extract the key information and save it to `/workspace/group/` as a named file.

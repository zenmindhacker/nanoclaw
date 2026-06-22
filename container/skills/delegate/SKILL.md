---
name: delegate
description: Delegate bounded text work to OpenCode Go worker models. You are the orchestrator — delegate mechanical work to cheaper workers, not back to yourself. Triggers on delegate, cheaper model, hand off, summarize with worker, draft with worker.
---

# Delegate (OpenCode Go)

You are the **orchestrator** (model from `$OPENCODE_MODEL`; see `models.json` `_meta.orchestrator`). Your job is to **plan, route, and respond**. Bounded work goes to **different** OpenCode Go models via `delegate`, so you save latency and subscription quota for judgment and conversation.

> **Do not delegate back to the orchestrator model.**

## Mental model

| Role | Lane | Tool |
|------|------|------|
| **You (orchestrator)** | `$OPENCODE_MODEL` | Main session — tools, memory, user chat |
| **Workers (text)** | Kimi K2.7, DeepSeek Flash, Qwen, GLM, … | `delegate <task> "..."` |
| **Image / video** | OpenRouter (legacy file only) | `delegate image "..."`, `delegate video "..."` |

Run `delegate list` for the live catalog — task keys map to workers; orchestrator ID is shown at the top.

## When to delegate (text)

- Summaries, extracts, translations, drafts you'll review
- Bounded code edits and refactors
- Long-document reads for one fact or a short summary
- Bulk mechanical transforms

## When NOT to delegate

- Live conversation with the user (presence + latency)
- Tool orchestration and multi-step planning in-thread
- Judgment where your voice and memory are the product
- Tasks under ~30s of your own attention

## Usage

```bash
delegate <task-or-model> "<prompt>"
delegate list
delegate cost <task> <input_tokens> <output_tokens>

# Multimodal image/video only (requires /workspace/extra/credentials/openrouter)
delegate image "minimal zen garden at sunset"
```

## Task catalog (preferred)

| Task | Worker | Notes |
|------|--------|-------|
| `summarize` | kimi-k2.7 | Long docs / transcripts |
| `summarize-fast` | deepseek-v4-flash | Short text |
| `long-context`, `doc-synthesis` | kimi-k2.7 | Multi-doc |
| `code-agentic` | kimi-k2.7 | Multi-step coding subagent |
| `code-cheap` | qwen3.6-plus | Refactors, boilerplate |
| `code-quick` | deepseek-v4-flash | Tiny edits |
| `code-frontier` | glm-5.2 | Only if cheaper workers failed |
| `reasoning-max` | qwen3.7-max | Strategic planning — use sparingly |
| `reasoning-cheap` | deepseek-v4-flash | Light analysis |
| `draft` | qwen3.6-plus | Prose you'll polish |
| `extract` | deepseek-v4-flash | JSON / structured output |
| `translate` | qwen3.6-plus | Multilingual |

Run `delegate list` for the live catalog.

## Examples

```bash
delegate summarize-fast "Summarize in 3 bullets: ..."
delegate extract "Return JSON array of action items: ..." --json
delegate code-cheap "Refactor to async/await; return only the function body: ..."
delegate reasoning-max "Compare three strategic options for Q3 hiring: ..."
delegate draft "Warm short reply declining a meeting: ..."
```

## Auth

- **Text workers**: OpenCode Go via OneCLI (`opencode.ai`). No raw API key in the container.
- **Image/video**: Legacy file `/workspace/extra/credentials/openrouter` (you may create/update per `/credentials` skill). Not OneCLI unless operator adds `openrouter.ai` there separately.

Voice notes are not owned by this skill. Use the `voice-note` skill with the
ElevenLabs voice ID and settings from `/workspace/global/CLAUDE.md`.

## Updating the catalog

Edit `models.json` next to this skill (host: `container/skills/delegate/models.json`). New containers pick it up on spawn. After an orchestrator swap, update `_meta.orchestrator` and host `.env` `OPENCODE_MODEL` together.

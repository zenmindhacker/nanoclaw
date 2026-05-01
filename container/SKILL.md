---
name: delegate
description: Delegate work to cheaper / specialized worker models via OpenCode. Use whenever a task is mechanical, bulk, or doesn't need frontier judgment — keep your Anthropic quota for orchestration. Triggers on phrases like "let me think", "delegate this", "run that on a cheaper model", or any time you'd otherwise burn Opus tokens on routine work.
---

# Delegate

You are the orchestrator. The point of this skill is to keep that role intact: you decide, you parse, you respond — but the **work** (code generation, summarization, extraction, drafting, translation, long-context reading) gets handed off to a worker model that's cheaper, faster, or both.

## Mental model

> "I am the planner. They are the workers."

Cheap models are extremely capable for bounded tasks. Don't burn Opus tokens on:
- Generating boilerplate code
- Summarizing a long transcript
- Translating text
- Extracting JSON from messy input
- Drafting a routine reply for me to review
- Refactoring a function
- Reading a long doc to find one fact

Do reach for Opus (yourself) for:
- Multi-step planning across a conversation
- Reading user mood and adjusting tone
- Tool selection / orchestration
- Anything the user is watching live

## How to use

```bash
delegate <key> "<prompt>"           # key = task name OR model name
delegate list                       # show catalog
delegate cost <key> <in> <out>      # estimate cost (token counts)
```

The `<key>` resolves through the catalog (`models.json`):
1. If it's in `tasks`, use the task's mapped model.
2. Otherwise look it up in `models` directly.

That means you can write `delegate code-cheap "..."` (intent-driven, recommended) or `delegate qwen-coder "..."` (explicit). Catalog can be updated without touching this skill.

## Quick examples

```bash
# Summarize a 60-page transcript — long context, cheap, throwaway
delegate summarize "<paste transcript text>" --file /workspace/extra/github/cognitivetech/coaching/kevin/transcripts/2026-04-29.md

# Extract action items as JSON — Haiku is reliable on structured output
delegate extract "From this transcript, return a JSON array of action items: {title, owner, priority}.

Transcript: ..." --json

# Draft a Slack reply — GLM is cheap and balanced
delegate draft "Cian asked if I can pick up the kids tomorrow. He's busy. Draft a warm, concise yes."

# Refactor a TypeScript function — qwen-coder, not Opus
delegate code-cheap "Refactor this to use map() instead of forEach. Return only the new function body:

function double(arr) { ... }"

# Hard reasoning the cheap models can't handle — only THEN reach for Sonnet/Opus
delegate code-frontier "Trace through why this React effect runs twice and propose a fix..."
```

## Catalog (snapshot — see `models.json` for live data)

Tasks (preferred — picks best worker for the job):

| Task key | Model | When |
|----------|-------|------|
| `code-cheap` | qwen-coder | Refactors, boilerplate, single-file edits |
| `code-quick` | haiku | Single-file no-reasoning |
| `code-frontier` | claude-sonnet | Multi-file reasoning, when qwen failed |
| `summarize` | kimi | Long docs/transcripts |
| `summarize-fast` | haiku | Short text |
| `long-context` | minimax | 1M+ tokens, multi-doc |
| `reasoning-cheap` | deepseek-r1 | Math / planning, with chain-of-thought |
| `reasoning-deep` | claude-opus | ONLY if all else fails |
| `draft` | glm | Default for prose drafts |
| `translate` | qwen | Multilingual |
| `extract` | haiku | Structured JSON output |

Run `delegate list` to see the live catalog with prices.

## Cost discipline

You are on a Max/Pro subscription. Every Opus token has opportunity cost. Defaults to internalize:

1. **First instinct**: can a cheap worker do this? If yes → delegate.
2. **One-shot work**: never use Opus for one-shot transforms (translate, summarize, extract). Always delegate.
3. **Drafts**: draft on a cheap model, polish with your own judgment if needed.
4. **Code edits**: try `code-cheap` first; only escalate to `code-frontier` if the result looks wrong.
5. **Estimate before delegating big jobs**: `delegate cost summarize 60000 1000` shows what a 60k-input run will cost.

## When NOT to delegate

- The user is mid-conversation and waiting on you — don't add latency for trivial tasks.
- The task is judgment-heavy (Slack tone, deciding what to do next, picking which transcripts matter).
- Sub-second response needed — opencode + remote model adds 2–8s latency.
- The task IS the conversation (you're the one talking to me).

## Authentication

Delegation requires OpenCode to have credentials for at least one provider. The first time:

```bash
# On the host, NOT in a container:
opencode auth login
```

Then pick provider(s). The auth file lands at `~/.local/share/opencode/auth.json` and is mounted read-only into every container at the same path. To add a provider later, re-run `opencode auth login` on the host — the next container spawn picks it up.

Recommended providers:
- **OpenRouter** — single key, access to Kimi/Qwen/GLM/Minimax/DeepSeek/Anthropic/OpenAI/Google. Easiest.
- **Anthropic** — direct, if you want Sonnet/Haiku/Opus billed separately from Max quota.
- **Moonshot, Alibaba, ZhipuAI direct** — cheapest per provider, but you manage N keys.

If `opencode run` errors with "no credentials", run `opencode auth login` on the host and try again.

## Updating the catalog

Prices drift. Refresh quarterly:

1. Visit https://models.dev (or each provider's pricing page).
2. Edit the catalog on the host: `~/nanoclaw/container/skills/delegate/models.json`. Containers pick up the change on next spawn (the file gets auto-copied into the container at startup).
3. Bump `_meta.lastReviewed`.
4. Add new models / tasks as needed — no code change required, the wrapper reads the catalog every call.

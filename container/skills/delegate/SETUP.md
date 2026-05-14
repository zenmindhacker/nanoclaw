# Delegate Skill — One-Time Setup

The container has OpenCode CLI baked into the image. What's missing on day one is **auth credentials** — without them, `delegate` calls fail with "no credentials". You need to run `opencode auth login` once on each host (Cleo's box and Silas's box) so the auth file lands in the right place to be mounted into containers.

## Step 1 — Install OpenCode on the host

You only need it on the host to RUN `opencode auth login`. The container already has its own copy.

```bash
# On cleo-lc, as user cian (Cleo's host)
ssh cian@cleo-lc.cognitivetech.net
npm install -g opencode-ai

# Repeat as user christina (Silas's host)
ssh christina@cleo-lc.cognitivetech.net
npm install -g opencode-ai
```

## Step 2 — Authenticate at least one provider

Recommended: **OpenRouter** — single API key, gives access to Kimi, Qwen, GLM, Minimax, DeepSeek, plus a fallback to Anthropic, OpenAI, Google. Lowest setup friction.

```bash
opencode auth login
# Pick: openrouter
# Paste your OpenRouter API key (https://openrouter.ai/keys)
```

This writes credentials to `~/.local/share/opencode/auth.json`. NanoClaw's mount-allowlist already includes that path; the next container spawn picks it up.

You can re-run `opencode auth login` anytime to add more providers (e.g. Moonshot directly for cheaper Kimi pricing). Stack as many as you want.

## Step 3 — Verify it works

From your laptop, send Cleo or Silas a message like:

> @cleo can you run `delegate list` and tell me what models I have?

Or test directly inside a container:

```bash
ssh cian@cleo-lc.cognitivetech.net
docker run --rm \
  -v /home/cian/.local/share/opencode:/workspace/extra/opencode:ro \
  -v /home/cian/nanoclaw/skills/delegate:/workspace/extra/skills/delegate:ro \
  --entrypoint bash nanoclaw-agent:latest \
  -c 'env XDG_DATA_HOME=/workspace/extra opencode models'
```

You should see a list of available models. If you see "no credentials configured", auth didn't land — re-run Step 2.

## How to update prices / add models

The catalog is `models.json`. Edit it to add/remove models or refresh prices — no code change needed.

```bash
ssh cian@cleo-lc.cognitivetech.net
$EDITOR /home/cian/nanoclaw/container/skills/delegate/models.json
```

The wrapper reads it on every call, so updates take effect on the next `delegate` invocation.

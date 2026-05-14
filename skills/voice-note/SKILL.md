# Voice Note Agent

Generates rich voice notes for Cian using Claude CLI + ElevenLabs.

**Note:** Uses Claude CLI binary (not OpenClaw subagent) because Anthropic blocked OAuth profiles.

## Workflow

### Step 1: Generate Script with Claude CLI

Use the wrapper script:

```bash
# Flexible length (default - let content breathe, can be 100-500+ words)
{baseDir}/scripts/generate-script.sh "topic description"

# Or specify word count
{baseDir}/scripts/generate-script.sh "topic description" 200
```

This calls `claude --print --model opus` with Cleo's voice profile and saves to `~/.openclaw/workspace/.tmp/latest-script.txt`.

**Default behavior:** No word limit - script length adapts to content (quick thought or longer story).

### Step 2: Read Script

```
read(path="/Users/cian/.openclaw/workspace/.tmp/latest-script.txt")
```

### Step 3: Generate Voice

```
~/.openclaw/workspace/skills/elevenlabs-voice/scripts/tts.sh "<script>"
```

**Voice Settings:**
- Voice ID: `4tRn1lSkEn13EVTuqb0g` (Serafina)
- Model: `eleven_multilingual_v2`
- Stability: 0.35, Similarity: 0.8, Style: 0.7, Speed: 1.2

### Step 4: Send to Cian

```
message(action="send", channel="slack", target="U07F1909LCQ", message="<caption>", media="<output-file>")
```

### Step 5: Context is Preserved

After you respond in Slack, I see the full conversation context. No need to pass context back — it's all in my session.

## Full Example

```bash
# 1. Generate script
exec("{baseDir}/scripts/generate-script.sh 'the pattern between Case/Kali and Cian/Cleo'")

# 2. Read script
script = read("/Users/cian/.openclaw/workspace/.tmp/latest-script.txt")

# 3. Generate voice
voice_file = exec("~/.openclaw/workspace/skills/elevenlabs-voice/scripts/tts.sh '" + script + "'")

# 4. Send
message(action="send", channel="slack", target="U07F1909LCQ", message="About that loop... 🧭", media=voice_file)
```

## Why This Works

- Claude CLI generates script directly (bills to Claude Code subscription)
- Script saved to temp file → read and pass to TTS
- Voice generated → send to Slack
- Full context preserved in session

## Troubleshooting

- **"Not logged in"**: Run `claude setup-token` or interactive login
- **Voice fails**: Check ElevenLabs credits
- **Wrong tone**: Edit `{baseDir}/scripts/generate-script.sh` prompt
- **Script generation slow**: Claude CLI can take 5-10 seconds for Opus
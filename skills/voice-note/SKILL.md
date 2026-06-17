# Voice Note

Generate ElevenLabs voice-note audio from final text.

This skill does **not** write the script for you. The orchestrator decides whether
to write the voice note directly or delegate a bounded draft, then revises the
text until it sounds like the agent. This skill only turns that final text into
an `.mp3` file.

## Source of Truth

Agent-specific voice choices live in the agent persona, not in this skill:

- Voice ID
- Stability, similarity, style, and speed
- When a voice note is appropriate
- Tone and relationship-specific guidance

Read `/workspace/global/CLAUDE.md` before generating audio and pass those values
to the command below.

## Command

```bash
/workspace/extra/skills/voice-note/bin/voice-note \
  --voice-id "<voice-id-from-persona>" \
  --stability 0.35 \
  --similarity 0.8 \
  --style 0.7 \
  --speed 1.2 \
  --text-file /workspace/ipc/voice-note.txt
```

The command prints the generated mp3 path. Send that file with the `send_file`
tool and include a short caption.

## Workflow

1. Decide whether voice is appropriate using the persona instructions.
2. Write the final spoken text yourself, or delegate a draft and revise it.
3. Save the final text to a file, usually under `/workspace/ipc/`.
4. Run `voice-note` with the voice ID and settings from `/workspace/global/CLAUDE.md`.
5. Send the returned mp3 path with `send_file`.

Example:

```bash
mkdir -p /workspace/ipc
printf '%s\n' "Final voice note text goes here." > /workspace/ipc/voice-note.txt

/workspace/extra/skills/voice-note/bin/voice-note \
  --voice-id "4tRn1lSkEn13EVTuqb0g" \
  --stability 0.35 \
  --similarity 0.8 \
  --style 0.7 \
  --speed 1.2 \
  --text-file /workspace/ipc/voice-note.txt
```

## Auth

The ElevenLabs API key is read from:

1. `/workspace/extra/credentials/elevenlabs`
2. `ELEVENLABS_API_KEY`

Never print or expose the key.

## Notes

- The default model is `eleven_multilingual_v2`.
- If the note is personal or emotionally specific, prefer writing it yourself.
- If you delegate a draft, always revise it before generating audio.
- Do not use `delegate speech` for persona voice notes unless the operator has
  explicitly asked for a generic fallback voice.
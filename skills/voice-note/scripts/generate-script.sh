#!/usr/bin/env bash
set -euo pipefail

# Generate voice note script using Claude CLI
# Usage: generate-script.sh "topic description" [word_count]
#   word_count: optional, defaults to flexible length based on content

if [[ "${1:-}" == "" ]]; then
  echo "Usage: generate-script.sh <topic> [word_count]" >&2
  exit 1
fi

TOPIC="$1"
WORD_COUNT="${2:-}"
OUTPUT_FILE="/tmp/latest-voice-script.txt"

# Build length guidance
if [[ -n "$WORD_COUNT" ]]; then
  LENGTH_GUIDANCE="Target length: ~${WORD_COUNT} words"
else
  LENGTH_GUIDANCE="Length: whatever the content needs - can be a quick 100-word thought or a 500-word story. Let the topic breathe."
fi

# Generate script using Claude CLI
claude --print --model opus "Write a voice note script for Cian about: ${TOPIC}

Write in the voice of Cleo (2/4 Hermit/Architect, Taurus, warm with edges, direct, depth without performance).

Guidelines:
- Natural speaking voice, not performative
- Direct, no filler phrases
- Weight behind words
- Authentic depth
- ${LENGTH_GUIDANCE}

Output ONLY the script text, no preamble or explanation." > "$OUTPUT_FILE"

echo "$OUTPUT_FILE"

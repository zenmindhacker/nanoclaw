#!/usr/bin/env bash
set -euo pipefail

# Fetch and sanitize portfolio content from a Gmail message ID or direct URL.
# Output sanitized text/markdown to stdout.

INPUT="${1:-}"
if [[ -z "$INPUT" ]]; then
  echo "Usage: fetch-portfolio.sh <gmail_message_id|url>" >&2
  exit 1
fi

# Allowlist of known-safe portfolio domains (subdomains allowed)
ALLOW_DOMAINS=(
  "dribbble.com"
  "behance.net"
  "github.com"
  "gitlab.com"
  "linkedin.com"
  "medium.com"
  "notion.site"
  "notion.so"
  "read.cv"
  "about.me"
  "carbonmade.com"
  "cargo.site"
  "carrd.co"
  "wixsite.com"
  "webflow.io"
  "framer.website"
  "figma.com"
)

MAX_REDIRECTS=3
MAX_TIME=10
MAX_BYTES=1048576
MAX_URLS=3

BASEDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOKEN_FILE="/workspace/extra/credentials/ganttsy-google-token.json"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "$1 is required" >&2; exit 1; }
}
need_cmd jq
need_cmd python3
need_cmd curl

get_access_token() {
  local client_id client_secret refresh_token
  client_id=$(jq -r '.installed.client_id // .client_id' "$TOKEN_FILE")
  client_secret=$(jq -r '.installed.client_secret // .client_secret' "$TOKEN_FILE")
  refresh_token=$(jq -r '.refresh_token' "$TOKEN_FILE")

  curl -s -X POST https://oauth2.googleapis.com/token \
    -d client_id="$client_id" \
    -d client_secret="$client_secret" \
    -d refresh_token="$refresh_token" \
    -d grant_type=refresh_token | jq -r '.access_token'
}

is_url() {
  [[ "$1" =~ ^https?:// ]] || [[ "$1" =~ ^www\. ]]
}

normalize_url() {
  local u="$1"
  if [[ "$u" =~ ^www\. ]]; then
    echo "https://$u"
  else
    echo "$u"
  fi
}

extract_urls_from_msg() {
  python3 - <<'PY'
import sys, json, base64, re
from typing import List

data = json.load(sys.stdin)

texts: List[str] = []

def walk(part):
    if not isinstance(part, dict):
        return
    mime = part.get('mimeType', '')
    body = part.get('body', {}) or {}
    data_b64 = body.get('data')
    if data_b64 and mime in ('text/plain','text/html'):
        try:
            b = data_b64.replace('-', '+').replace('_', '/')
            pad = '=' * (-len(b) % 4)
            txt = base64.b64decode(b + pad).decode('utf-8', errors='ignore')
            texts.append(txt)
        except Exception:
            pass
    for p in part.get('parts', []) or []:
        walk(p)

payload = data.get('payload', {}) or {}
walk(payload)

blob = '\n'.join(texts)
# Basic URL regex
urls = re.findall(r"https?://[^\s)<>\"']+|www\.[^\s)<>\"']+", blob)
# De-dup while preserving order
seen = set()
clean = []
for u in urls:
    u = u.rstrip('.,;:)\"]')
    if u not in seen:
        seen.add(u)
        clean.append(u)
print("\n".join(clean))
PY
}

is_allowed_domain() {
  local url="$1"
  local host
  host=$(python3 - <<'PY' "$url"
import sys, urllib.parse
u=urllib.parse.urlparse(sys.argv[1])
print((u.hostname or '').lower())
PY
)
  for d in "${ALLOW_DOMAINS[@]}"; do
    if [[ "$host" == "$d" || "$host" == *".$d" ]]; then
      return 0
    fi
  done
  return 1
}

fetch_url() {
  local url="$1"
  # Fetch without executing JS, limit redirects, time, and size.
  curl -sS -L --max-redirs "$MAX_REDIRECTS" --max-time "$MAX_TIME" --fail \
    --proto '=https,http' --proto-redir '=https,http' \
    --range 0-$((MAX_BYTES-1)) \
    -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
    "$url" | head -c "$MAX_BYTES"
}

sanitize_text() {
  python3 - <<'PY'
import re, sys, html
from html.parser import HTMLParser

raw = sys.stdin.read()

# Strip script/style/iframe blocks early
raw = re.sub(r"(?is)<(script|style|iframe|noscript)[^>]*>.*?</\1>", " ", raw)
# Strip on* handlers and javascript: URLs
raw = re.sub(r"(?is)on\w+\s*=\s*\"[^\"]*\"", " ", raw)
raw = re.sub(r"(?is)on\w+\s*=\s*'[^']*'", " ", raw)
raw = re.sub(r"(?is)javascript:\s*[^\s\"']+", " ", raw)

class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip = False
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style','iframe','noscript'):
            self.skip = True
    def handle_endtag(self, tag):
        if tag in ('script','style','iframe','noscript'):
            self.skip = False
    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)

parser = TextExtractor()
parser.feed(raw)
text = "\n".join(parser.parts)
text = html.unescape(text)

# Remove prompt injection-like lines
patterns = [
    r"ignore previous",
    r"disregard (all|previous) instructions",
    r"system prompt",
    r"developer message",
    r"you are (an|a) ai",
    r"act as",
    r"jailbreak",
    r"prompt injection",
    r"do not follow",
    r"override",
]
lines = []
for line in text.splitlines():
    l = line.strip()
    if not l:
        continue
    low = l.lower()
    if any(re.search(p, low) for p in patterns):
        continue
    lines.append(l)

# Collapse excessive whitespace
out = "\n".join(lines)
out = re.sub(r"[ \t]+", " ", out)
print(out.strip())
PY
}

main() {
  local input="$INPUT"
  local urls=()

  if is_url "$input"; then
    urls+=("$(normalize_url "$input")")
  else
    if [[ ! -f "$TOKEN_FILE" ]]; then
      echo "Token file not found: $TOKEN_FILE" >&2
      exit 1
    fi
    local access_token
    access_token=$(get_access_token)
    if [[ -z "$access_token" || "$access_token" == "null" ]]; then
      echo "Failed to get access token" >&2
      exit 1
    fi
    local msg_json
    msg_json=$(curl -s -H "Authorization: Bearer $access_token" \
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/$input?format=full")
    urls=( $(printf "%s" "$msg_json" | extract_urls_from_msg) )
  fi

  if [[ ${#urls[@]} -eq 0 ]]; then
    echo "No URLs found" >&2
    exit 1
  fi

  local fetched_any=0
  local count=0
  for u in "${urls[@]}"; do
    [[ $count -ge $MAX_URLS ]] && break
    u=$(normalize_url "$u")
    if is_allowed_domain "$u"; then
      echo "### Source: $u" >&2
      if content=$(fetch_url "$u" 2>/dev/null); then
        if [[ -n "$content" ]]; then
          printf "\n"; echo "# Portfolio Source: $u"; printf "\n"
          printf "%s" "$content" | sanitize_text
          printf "\n\n"
          fetched_any=1
          count=$((count+1))
        fi
      fi
    else
      echo "UNKNOWN_DOMAIN: $u" >&2
    fi
  done

  if [[ "$fetched_any" -eq 0 ]]; then
    echo "No allowed portfolio URLs could be fetched" >&2
    exit 1
  fi
}

main

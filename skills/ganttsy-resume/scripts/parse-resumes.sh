#!/usr/bin/env bash
set -euo pipefail

BASEDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW_DIR="$BASEDIR/candidates/raw"
MD_DIR="$BASEDIR/candidates/md"

mkdir -p "$MD_DIR"

if [[ ! -d "$RAW_DIR" ]]; then
  echo "Raw dir not found: $RAW_DIR" >&2
  exit 1
fi

convert_pdf() {
  local in="$1" out_txt="$2"
  if command -v pdftotext >/dev/null 2>&1; then
    pdftotext "$in" "$out_txt"
  elif command -v python >/dev/null 2>&1; then
    python - <<'PY' "$in" "$out_txt"
import sys
from pathlib import Path
try:
  import pdfplumber
except Exception:
  sys.exit("pdfplumber not installed; install or use pdftotext")

inp=Path(sys.argv[1])
out=Path(sys.argv[2])
text=[]
with pdfplumber.open(inp) as pdf:
  for page in pdf.pages:
    text.append(page.extract_text() or "")
out.write_text("\n\n".join(text))
PY
  else
    echo "No PDF converter available (pdftotext or pdfplumber)" >&2
    return 1
  fi
}

convert_docx() {
  local in="$1" out_txt="$2"
  if command -v pandoc >/dev/null 2>&1; then
    pandoc "$in" -t plain -o "$out_txt"
  elif command -v textutil >/dev/null 2>&1; then
    textutil -convert txt -output "$out_txt" "$in" >/dev/null
  else
    echo "No DOCX converter available (pandoc or textutil)" >&2
    return 1
  fi
}

extract_info() {
  local md_file="$1" json_out="$2"
  python - <<'PY' "$md_file" "$json_out"
import re,sys,json
from pathlib import Path

p=Path(sys.argv[1])
text=p.read_text(errors='ignore')
lines=[l.strip() for l in text.splitlines() if l.strip()]

email_match=re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text)
email=email_match.group(0) if email_match else ""

name=""
for l in lines[:10]:
  if email and email in l:
    continue
  if re.search(r"[A-Za-z]{2,}\s+[A-Za-z]{2,}", l) and len(l)<60:
    name=l
    break

experience=""
exp_match=re.search(r"(?is)(experience|work experience)\s*[:\n]+(.{0,600})", text)
if exp_match:
  experience=exp_match.group(2).strip().split('\n')[0:5]
  experience=" ".join(experience)
else:
  yrs=re.search(r"(\d+\+?\s*years?)", text, re.I)
  experience=yrs.group(1) if yrs else ""

skills=[]
sk_match=re.search(r"(?is)skills\s*[:\n]+(.{0,400})", text)
if sk_match:
  block=sk_match.group(1)
  # take first line or up to 200 chars
  line=block.strip().split('\n')[0]
  skills=[s.strip() for s in re.split(r"[,;/]", line) if s.strip()]

out={"name":name,"email":email,"experience":experience,"skills":skills}
Path(sys.argv[2]).write_text(json.dumps(out,indent=2))
PY
}

new_count=0
for file in "$RAW_DIR"/*; do
  [[ -f "$file" ]] || continue
  base=$(basename "$file")
  ext="${base##*.}"
  stem="${base%.*}"
  md_out="$MD_DIR/$stem.md"
  txt_tmp="$MD_DIR/$stem.txt"

  if [[ -f "$md_out" ]]; then
    continue
  fi

  case "$ext" in
    pdf|PDF)
      convert_pdf "$file" "$txt_tmp"
      ;;
    docx|DOCX|doc|DOC)
      convert_docx "$file" "$txt_tmp"
      ;;
    *)
      continue
      ;;
  esac

  if [[ ! -s "$txt_tmp" ]]; then
    continue
  fi

  {
    echo "# $stem"
    echo ""
    cat "$txt_tmp"
  } > "$md_out"

  rm -f "$txt_tmp"
  extract_info "$md_out" "$MD_DIR/$stem.json"
  new_count=$((new_count+1))

done

echo "NEW_PARSED=$new_count"

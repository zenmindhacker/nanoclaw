#!/usr/bin/env bash
set -euo pipefail

LINEAR="node --experimental-strip-types /workspace/extra/skills/linear/scripts/linear.ts"
ENVF=""  # Linear API keys come from environment (set by NC container)

if [[ -f "$ENVF" ]]; then
  # shellcheck disable=SC1090
  source "$ENVF"
fi

usage() {
  cat <<'EOF'
Usage:
  linear-router <org> my
  linear-router <org> defaults
  linear-router <org> create-smart "Title" ["Description"] [--yes] [--project <name>] [--labels <a,b>] [--priority <level>] [--state <state>] [--assignee <email>] [--no-milestone]
  linear-router <org> <any linear.ts command...>

Org aliases:
  ct | copperteams | copper
  cog | cognitive | cognitive-tech | ctci
  gan | ganttsy

Examples:
  linear-router cog my
  linear-router cog defaults
  linear-router gan create-smart "Implement X" "Context..." --yes
  linear-router ct create "Fix dashboard auth" -d "Details" --priority high
  linear-router cog list --status "In Progress"
  linear-router cog get COG-42
EOF
}

if [[ $# -lt 2 ]]; then
  usage
  exit 1
fi

org_raw="$1"; shift
org_lower="$(echo "$org_raw" | tr '[:upper:]' '[:lower:]')"

# Resolve canonical org key + profile defaults
case "$org_lower" in
  ct|copperteams|copper)
    org_key="ct"
    repo="/Users/cian/Documents/GitHub/copperteams"
    profile_project="Kora Voice Integration"
    profile_labels="Feature"
    profile_priority="medium"
    profile_state="backlog"
    ;;
  cog|ctci|cognitive|cognitive-tech)
    org_key="cog"
    repo="/Users/cian/Documents/GitHub/cognitive-tech"
    profile_project="Cognitive Tech"
    profile_labels=""
    profile_priority="medium"
    profile_state="backlog"
    ;;
  gan|ganttsy)
    org_key="gan"
    repo="/Users/cian/Documents/GitHub/ganttsy"
    profile_project="Ganttsy MVP"
    profile_labels="CTO Track"
    profile_priority="medium"
    profile_state="todo"
    ;;
  *)
    echo "Unknown org: $org_raw"
    usage
    exit 2
    ;;
esac

cmd="${1:-}"

# my — shorthand for listing your in-progress issues
if [[ "$cmd" == "my" ]]; then
  shift || true
  $LINEAR --org "$org_key" my-issues "$@"
  exit $?
fi

if [[ "$cmd" == "team" ]]; then
  shift || true
  $LINEAR --org "$org_key" team-issues "$@"
  exit $?
fi

# repo — print the local repo path for this org
if [[ "$cmd" == "repo" ]]; then
  echo "$repo"
  exit 0
fi

# defaults — show the org's create profile
if [[ "$cmd" == "defaults" ]]; then
  cat <<EOF
Org: $org_raw  →  key: $org_key
Repo: $repo
Default create profile:
  project:  ${profile_project:-(none)}
  labels:   ${profile_labels:-(none)}
  priority: ${profile_priority:-(none)}
  state:    ${profile_state:-(none)}
  assignee: me
EOF
  exit 0
fi

# create-smart — interactive create with org-profile defaults
if [[ "$cmd" == "create-smart" ]]; then
  shift || true
  title="${1:-}"; shift || true
  description="${1:-}"; shift || true

  if [[ -z "$title" ]]; then
    echo "Usage: linear-router <org> create-smart \"Title\" [\"Description\"] [--yes] [overrides...]" >&2
    exit 1
  fi

  confirm="no"
  project="$profile_project"
  labels="$profile_labels"
  priority="$profile_priority"
  state="$profile_state"
  assignee="me"
  no_milestone="no"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --yes)       confirm="yes"; shift ;;
      --project)   project="${2:-}"; shift 2 ;;
      --labels)    labels="${2:-}"; shift 2 ;;
      --priority)  priority="${2:-}"; shift 2 ;;
      --state)     state="${2:-}"; shift 2 ;;
      --assignee)  assignee="${2:-}"; shift 2 ;;
      --no-milestone) no_milestone="yes"; shift ;;
      *) echo "Unknown create-smart option: $1" >&2; exit 1 ;;
    esac
  done

  if [[ "$confirm" != "yes" ]]; then
    cat <<EOF
Planned create for $org_raw:
  title:    $title
  project:  ${project:-(none)}
  labels:   ${labels:-(none)}
  priority: ${priority:-(none)}
  state:    ${state:-(none)}
  assignee: ${assignee}

Re-run with --yes to create.
EOF
    exit 0
  fi

  args=(create "$title")
  [[ -n "$description" ]]  && args+=(-d "$description")
  [[ -n "$labels" ]]       && args+=(--labels "$labels")
  [[ -n "$priority" ]]     && args+=(-p "$priority")
  [[ -n "$state" ]]        && args+=(-s "$state")
  [[ -n "$project" ]]      && args+=(--project "$project")
  [[ "$no_milestone" == "yes" ]] && args+=(--no-milestone)

  $LINEAR --org "$org_key" "${args[@]}" --assignee "$assignee"
  exit $?
fi

# Pass-through all other commands directly to linear.ts
$LINEAR --org "$org_key" "$@"

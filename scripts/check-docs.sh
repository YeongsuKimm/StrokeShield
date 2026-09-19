#!/usr/bin/env bash
# Keeps project context current. Run automatically by .githooks/pre-push and CI.
#
#   scripts/check-docs.sh [<git-range>]        default: origin/main...HEAD
#
# ERRORS (exit 1):
#   1. Code changed but docs/STATUS.md was not updated.
#   2. Shared contracts changed out of sync: contracts.ts, schemas.py and docs/spec/01-architecture.md must change together.
# WARNINGS (exit 0): a module's code changed but its spec file did not ("did behavior or decisions change?").
# Bypass (use sparingly): SKIP_DOCS_CHECK=1, or put [skip-docs] in a commit message in the range.
set -euo pipefail

range="${1:-origin/main...HEAD}"

if [[ "${SKIP_DOCS_CHECK:-}" == "1" ]]; then echo "docs check skipped (SKIP_DOCS_CHECK=1)"; exit 0; fi
if ! changed=$(git diff --name-only "$range" 2>/dev/null); then
  echo "docs check: could not diff '$range' (no origin/main yet?) - skipping"; exit 0
fi
if git log --format=%B "$range" 2>/dev/null | grep -qF '[skip-docs]'; then
  echo "docs check skipped ([skip-docs] in a commit message)"; exit 0
fi

touched() { grep -qxE "$1" <<<"$changed"; }

# "Code" = source that changes behavior. Tests, markdown, lockfiles and .gitkeep don't count.
code=$(grep -E '^(frontend/src|backend|models|services)/|^\.env\.example$|^requirements[^/]*\.txt$|^frontend/package\.json$' <<<"$changed" \
  | grep -vE '(\.test\.ts$|\.md$|\.gitkeep$)' || true)
if [[ -z "$code" ]]; then echo "docs check: no code changes in $range - ok"; exit 0; fi

errors=0
warnings=0

if ! touched 'docs/STATUS\.md'; then
  echo "ERROR: code changed but docs/STATUS.md was not updated."
  echo "       Update your module's row and add a line to 'Recent changes' (newest first)."
  errors=1
fi

# Contracts must move together.
contracts='frontend/src/lib/contracts\.ts'; schemas='backend/schemas\.py'; archspec='docs/spec/01-architecture\.md'
if touched "$contracts" || touched "$schemas"; then
  for f in "$contracts:frontend/src/lib/contracts.ts" "$schemas:backend/schemas.py" "$archspec:docs/spec/01-architecture.md"; do
    if ! touched "${f%%:*}"; then
      echo "ERROR: shared contracts changed but ${f#*:} did not. contracts.ts, schemas.py and docs/spec/01-architecture.md must change together."
      errors=1
    fi
  done
fi

# Per-module spec nudges (warnings only). Format: "code-regex#spec-regex#spec name"
while IFS='#' read -r code_re spec_re spec_name; do
  [[ -z "$code_re" ]] && continue
  if grep -qE "$code_re" <<<"$code" && ! touched "$spec_re"; then
    echo "warning: ${spec_name} not updated although its code changed. Did behavior, thresholds, protocol or decisions change? If so, update the spec."
    warnings=$((warnings + 1))
  fi
done <<'MAP'
^(frontend/src/lib/vision/|models/vision\.py|backend/routers/vision\.py)#docs/spec/02-vision\.md#docs/spec/02-vision.md
^(frontend/src/lib/speech/|models/audio\.py|models/config\.py|backend/routers/speech\.py)#docs/spec/03-speech\.md#docs/spec/03-speech.md
^(frontend/src/lib/agent/|backend/routers/agent\.py|services/elevenlabs_service\.py)#docs/spec/0[34]-.*\.md#docs/spec/04-voice-agent.md (or 03-speech.md)
^(services/twilio_service\.py|backend/routers/alert\.py|frontend/src/lib/risk\.ts)#docs/spec/05-risk-and-alerts\.md#docs/spec/05-risk-and-alerts.md
^(frontend/src/components/|frontend/src/App\.tsx|frontend/src/lib/session/)#docs/spec/06-frontend-ux\.md#docs/spec/06-frontend-ux.md
^(backend/main\.py|backend/settings\.py|\.env\.example|requirements[^/]*\.txt)#docs/spec/01-architecture\.md#docs/spec/01-architecture.md
MAP

if (( errors )); then
  echo
  echo "Docs check FAILED. Fix the above, or bypass once with SKIP_DOCS_CHECK=1 / a [skip-docs] commit tag."
  exit 1
fi
if (( warnings )); then echo "docs check passed ($warnings warning(s))"; else echo "docs check passed"; fi

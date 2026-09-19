#!/usr/bin/env bash
# One-time per clone: enable the repo's git hooks (docs/context check on push).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath .githooks
chmod +x .githooks/* scripts/*.sh
echo "Hooks enabled (core.hooksPath=.githooks). Pushes that change code must also update docs/STATUS.md."

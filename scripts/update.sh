#!/usr/bin/env bash
set -euo pipefail

# Pulls the latest skill version and refreshes its dependencies.
# Works on the checkout that ~/.claude/skills/signum-smartc links to.

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${SKILL_DIR}"

OLD_VERSION="$(cat VERSION 2>/dev/null || echo unknown)"
OLD_REV="$(git rev-parse HEAD)"

echo ""
echo "signum-smartc skill — update (installed: v${OLD_VERSION})"
echo ""

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "✗  The checkout at ${SKILL_DIR} has local changes."
    echo "   Commit or stash them, then run the update again."
    exit 1
fi

git pull --ff-only --quiet

NEW_VERSION="$(cat VERSION)"
NEW_REV="$(git rev-parse HEAD)"

if [ "${OLD_REV}" = "${NEW_REV}" ]; then
    echo "✓  Already up to date (v${NEW_VERSION})"
    exit 0
fi

echo "✓  Updated v${OLD_VERSION} → v${NEW_VERSION}"
echo ""
echo "── What's new ─────────────────────────────────────────────"
# The changelog lines added since the previous checkout.
git diff "${OLD_REV}" "${NEW_REV}" -- CHANGELOG.md \
    | grep '^+' | grep -v '^+++' | sed 's/^+//' || true
echo "───────────────────────────────────────────────────────────"
echo ""

# Re-running the installer is safe: it keeps the existing link and only
# refreshes Bun packages to the versions this release expects.
bash "${SKILL_DIR}/scripts/install.sh"

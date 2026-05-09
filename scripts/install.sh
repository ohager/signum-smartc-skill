#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_NAME="signum-smartc"
SKILLS_DIR="${HOME}/.claude/skills"
SKILL_LINK="${SKILLS_DIR}/${SKILL_NAME}"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  signum-smartc skill — installer                     ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── 1. Install skill into Claude Code ────────────────────────────────────────

if [ ! -d "${SKILLS_DIR}" ]; then
    echo "✗  Claude Code skills directory not found at ${SKILLS_DIR}"
    echo "   Make sure Claude Code is installed before running this script."
    exit 1
fi

if [ -L "${SKILL_LINK}" ]; then
    echo "✓  Skill already linked at ${SKILL_LINK}"
elif [ -d "${SKILL_LINK}" ]; then
    echo "✓  Skill already installed at ${SKILL_LINK}"
else
    ln -s "${SKILL_DIR}" "${SKILL_LINK}"
    echo "✓  Skill linked: ${SKILL_LINK} → ${SKILL_DIR}"
fi

# ── 2. Bun ────────────────────────────────────────────────────────────────────

if command -v bun &>/dev/null; then
    echo "✓  Bun already installed ($(bun --version))"
else
    echo "→  Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="${HOME}/.bun/bin:${PATH}"
    echo "✓  Bun installed ($(bun --version))"
fi

# ── 3. smartc-signum-compiler ─────────────────────────────────────────────────

echo "→  Installing smartc-signum-compiler..."
cd "${SKILL_DIR}"
bun add smartc-signum-compiler
echo "✓  smartc-signum-compiler installed"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Installation complete                               ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Restart Claude Code to activate the skill."
echo ""
echo "  Compile a contract:"
echo "    bun ${SKILL_DIR}/scripts/compile.js <contract.smart.c>"
echo ""

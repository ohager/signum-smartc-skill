#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_NAME="signum-smartc"
SKILLS_DIR="${HOME}/.claude/skills"
SKILL_LINK="${SKILLS_DIR}/${SKILL_NAME}"
SKILL_VERSION="$(cat "${SKILL_DIR}/VERSION" 2>/dev/null || echo unknown)"
# The compiler release the references document; see "Documents" in SKILL.md.
COMPILER_RANGE="~2.3.0"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  signum-smartc skill — installer                     ║"
printf "║  %-52s║\n" "version ${SKILL_VERSION}"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── 1. Install skill into Claude Code ────────────────────────────────────────

if [ ! -d "${SKILLS_DIR}" ]; then
    mkdir -p "${SKILLS_DIR}"
    echo "✓  Created skills directory at ${SKILLS_DIR}"
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

echo "→  Installing smartc-signum-compiler@${COMPILER_RANGE}..."
cd "${SKILL_DIR}"
bun add "smartc-signum-compiler@${COMPILER_RANGE}"
echo "✓  smartc-signum-compiler installed"

# ── 4. vitest (dev — runs the gas-analyzer tests) ─────────────────────────────

echo "→  Installing vitest (dev)..."
bun add -d vitest
echo "✓  vitest installed"

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
echo "  Analyse gas cost (per-handler min/max, activation sizing):"
echo "    bun ${SKILL_DIR}/scripts/gas-analysis.js <contract.smart.c>"
echo ""
echo "  Run the skill's own tests:"
echo "    bun vitest run"
echo ""
echo "  Update to the latest version later:"
echo "    bash ${SKILL_DIR}/scripts/update.sh"
echo ""

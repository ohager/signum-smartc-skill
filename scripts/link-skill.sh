#!/usr/bin/env bash
set -euo pipefail

# Links the skill into Claude Code's skill directory. Usage: link-skill.sh [skill dir]
# A plugin install is left alone: Claude Code already loads the plugin's skill, and a
# link into the versioned plugin cache would show the skill twice and dangle after the
# next plugin update.

SKILL_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SKILL_NAME="signum-smartc"
SKILLS_DIR="${HOME}/.claude/skills"
SKILL_LINK="${SKILLS_DIR}/${SKILL_NAME}"

case "${SKILL_DIR}" in
    */.claude/plugins/*)
        echo "✓  Installed as a Claude Code plugin; the plugin provides the skill, no link needed"
        echo "   (re-run this installer after a plugin update to restore the compiler)"
        exit 0
        ;;
esac

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

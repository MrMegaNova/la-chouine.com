#!/usr/bin/env bash
# Installe les plugins Claude Code et le hook rtk dans le volume ~/.claude.
#
# Exécuté par postCreateCommand : le volume claude-code-config est alors monté,
# donc ce que l'on écrit ici persiste pour la durée de vie du devcontainer.
# Idempotent : ré-exécutable sans casse (les ré-installs sont sans effet).
#
# Le binaire rtk lui-même est cuit dans l'image (voir Dockerfile) ; ici on ne
# fait que (re)brancher son hook PreToolUse.
set -uo pipefail

echo "→ Marketplaces Claude Code"
# Marketplace officielle (normalement déjà connue) + caveman (communautaire).
# URLs https explicites pour ne pas dépendre d'une clé SSH.
claude plugin marketplace add https://github.com/anthropics/claude-plugins-official || true
claude plugin marketplace add https://github.com/JuliusBrussee/caveman || true

echo "→ Plugins"
claude plugin install caveman@caveman || true
claude plugin install context7@claude-plugins-official || true
claude plugin install typescript-lsp@claude-plugins-official || true

echo "→ rtk (hook PreToolUse Bash)"
if command -v rtk >/dev/null 2>&1; then
  rtk init -g --auto-patch || true
else
  echo "  ⚠ binaire rtk introuvable — il devrait être fourni par l'image (Dockerfile)."
fi

echo "✓ Setup plugins Claude Code terminé."

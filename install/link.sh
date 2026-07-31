#!/usr/bin/env bash
# Symlink every config in this repo into its expected location.
# Safe to re-run: existing files are backed up, correct links are left alone.

set -euo pipefail
# shellcheck source=install/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

case "$(uname -s)" in
Darwin) LAZYGIT_CONFIG="$HOME/Library/Application Support/lazygit/config.yml" ;;
*) LAZYGIT_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/lazygit/config.yml" ;;
esac

CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"

log "linking configs from $DOTFILES_ROOT"

# Neovim and Kitty own their whole config directory.
link nvim "$CONFIG_HOME/nvim"
link kitty "$CONFIG_HOME/kitty"

# Herdr keeps sockets, logs and session state next to its config, so only the
# config file is linked and the directory stays local.
link herdr/config.toml "$CONFIG_HOME/herdr/config.toml"

link lazygit/config.yml "$LAZYGIT_CONFIG"

link zsh/zshrc "$HOME/.zshrc"
link zsh/zprofile "$HOME/.zprofile"

# pi: link individual files only. ~/.pi/agent also holds auth.json, session
# transcripts and model caches, which must stay out of the repo.
PI_AGENT="$HOME/.pi/agent"
link pi/settings.json "$PI_AGENT/settings.json"
link pi/themes/terminal-user-card.json "$PI_AGENT/themes/terminal-user-card.json"
link pi/extensions/clean-code-blocks.ts "$PI_AGENT/extensions/clean-code-blocks.ts"
link pi/agents/review.md "$PI_AGENT/agents/review.md"
for prompt in review pr-comment video; do
	link "pi/prompts/$prompt.md" "$PI_AGENT/prompts/$prompt.md"
done
link pi/skills/video "$PI_AGENT/skills/video"
# Skill helper scripts live in pi/scripts and are exposed at ~/.pi/agent/scripts.
link pi/scripts "$PI_AGENT/scripts"

log "done"

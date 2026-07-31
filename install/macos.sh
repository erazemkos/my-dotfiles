#!/usr/bin/env bash
# macOS bootstrap: install every dependency these configs need, then link them.
# Usage: install/macos.sh

set -euo pipefail
# shellcheck source=install/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

[ "$(uname -s)" = "Darwin" ] || die "this script is for macOS; use install/debian.sh instead"

if ! have brew; then
	die "Homebrew is required: https://brew.sh (then re-run this script)"
fi

FORMULAE=(
	# editor + core CLI used by the nvim config
	neovim
	git
	make
	ripgrep # telescope live_grep
	fd      # telescope find_files
	fzf
	jq
	tree-sitter
	# git tooling: delta is the pager in ~/.gitconfig and lazygit
	git-delta
	lazygit
	gh
	# shell
	zsh
	zoxide   # `cd` replacement in .zshrc
	autojump # oh-my-zsh autojump plugin
	# file manager (`y` function in .zshrc, yazi.nvim)
	yazi
	# yazi preview backends
	ffmpeg
	poppler
	imagemagick
	sevenzip
	# language toolchains for mason-installed LSPs/formatters
	node
	go
	python@3.13
	# terminal multiplexer for agents
	herdr
)

CASKS=(
	kitty
	font-jetbrains-mono-nerd-font # kitty.conf font_family
)

NPM_GLOBALS=(
	"@earendil-works/pi-coding-agent" # pi
	hunkdiff                          # `hunk` custom command in lazygit config
)

log "installing Homebrew formulae"
brew install "${FORMULAE[@]}"

log "installing Homebrew casks"
brew install --cask "${CASKS[@]}"

log "installing global npm packages"
npm install -g "${NPM_GLOBALS[@]}"

if [ ! -d "$HOME/.oh-my-zsh" ]; then
	log "installing oh-my-zsh"
	RUNZSH=no KEEP_ZSHRC=yes sh -c \
		"$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
fi

ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
clone_plugin() {
	local repo="$1" dest="$ZSH_CUSTOM/plugins/$2"
	if [ -d "$dest" ]; then
		log "ok $dest"
	else
		log "cloning $repo"
		git clone --depth 1 "https://github.com/$repo" "$dest"
	fi
}
clone_plugin zsh-users/zsh-autosuggestions zsh-autosuggestions
clone_plugin zsh-users/zsh-syntax-highlighting zsh-syntax-highlighting

"$DOTFILES_ROOT/install/link.sh"

if [ "${SHELL:-}" != "$(command -v zsh)" ]; then
	log "to make zsh the login shell: chsh -s $(command -v zsh)"
fi

log "next: open nvim once so lazy.nvim and mason install plugins/LSPs"

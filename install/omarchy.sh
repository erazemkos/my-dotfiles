#!/usr/bin/env bash
# Omarchy (Arch Linux) bootstrap: extend the stock installation with the tools
# required by these dotfiles, replace conflicting managed configs, and link the
# repository copies into place.
# Usage: install/omarchy.sh

set -euo pipefail
# shellcheck source=install/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

[ "$(uname -s)" = "Linux" ] || die "this script is for Omarchy on Linux"
have omarchy || die "Omarchy is required; use another installer on non-Omarchy systems"
have pacman || die "pacman is required"
[ "$(id -u)" -ne 0 ] || die "run this installer as your normal user, not root"

# Omarchy's package helper is idempotent. Build the list by command so tools
# already supplied by Omarchy, mise, or a previous manual install are preserved.
ARCH_PACKAGES=()
need_command() {
	local command="$1" package="$2"
	have "$command" || ARCH_PACKAGES+=("$package")
}

need_command gcc base-devel
need_command make base-devel
need_command git git
need_command curl curl
need_command unzip unzip
need_command nvim neovim
need_command kitty kitty
need_command zsh zsh
need_command rg ripgrep
need_command fd fd
need_command fzf fzf
need_command jq jq
need_command tree-sitter tree-sitter-cli
need_command delta git-delta
need_command lazygit lazygit
need_command tuicr tuicr
need_command zoxide zoxide
need_command yazi yazi
need_command ffmpeg ffmpeg
need_command pdftoppm poppler
need_command magick imagemagick
need_command 7z 7zip
need_command go go
need_command python python
need_command herdr herdr
need_command fc-list fontconfig

# Avoid asking pacman for the same package twice (for example, base-devel).
if ((${#ARCH_PACKAGES[@]})); then
	mapfile -t ARCH_PACKAGES < <(printf '%s\n' "${ARCH_PACKAGES[@]}" | awk '!seen[$0]++')
	log "installing missing Arch packages"
	omarchy pkg add "${ARCH_PACKAGES[@]}"
else
	log "all Arch package dependencies are already available"
fi

# The zsh config enables Oh My Zsh's autojump plugin. autojump is currently in
# the AUR rather than the official Arch repositories.
if ! have autojump; then
	log "installing autojump from the AUR"
	omarchy pkg aur add autojump
else
	log "ok autojump"
fi

# A basic JetBrainsMono Nerd Font is enough; do not replace Omarchy's smaller
# stock package with the full font package when the configured family exists.
if ! fc-list 2>/dev/null | grep -Fqi "JetBrainsMono Nerd Font"; then
	log "installing JetBrainsMono Nerd Font"
	omarchy pkg add ttf-jetbrains-mono-nerd
else
	log "ok JetBrainsMono Nerd Font"
fi

# Omarchy manages Node and agent/CLI wrappers with mise. Keep that convention
# instead of installing duplicate system or global-npm copies.
have mise || die "mise is missing from this Omarchy installation"
if ! have node || ! have npm; then
	log "installing current Node.js with mise"
	mise use -g node@latest
else
	log "ok node $(node --version)"
fi

ensure_mise_wrapper() {
	local package="$1" command="$2" bin="${3:-$2}"
	if have "$command"; then
		log "ok $command"
	else
		log "installing Omarchy mise wrapper for $command"
		omarchy-mise-install "$package" "$command" "$bin"
	fi
}
ensure_mise_wrapper gh gh
ensure_mise_wrapper aqua:modem-dev/hunk hunk
ensure_mise_wrapper pi pi

install_git_checkout() {
	local repo="$1" dest="$2"
	if [ -d "$dest/.git" ]; then
		log "ok $dest"
	else
		if [ -e "$dest" ] || [ -L "$dest" ]; then
			log "remove conflicting $dest"
			rm -rf -- "$dest"
		fi
		log "cloning $repo -> $dest"
		git clone --depth 1 "https://github.com/$repo" "$dest"
	fi
}

install_git_checkout ohmyzsh/ohmyzsh "$HOME/.oh-my-zsh"
ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}"
install_git_checkout zsh-users/zsh-autosuggestions "$ZSH_CUSTOM/plugins/zsh-autosuggestions"
install_git_checkout zsh-users/zsh-syntax-highlighting "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting"

install_godbg

# Unlike the cross-platform installers, adopting these dotfiles on Omarchy is
# intentional replacement: discard stock nvim/kitty and any other managed
# destination that conflicts rather than keeping backup copies.
DOTFILES_CONFLICT_MODE=remove "$DOTFILES_ROOT/install/link.sh"
install_pi_packages

login_shell="$(getent passwd "$(id -un)" | cut -d: -f7)"
if [ "$login_shell" != "$(command -v zsh)" ]; then
	log "to make zsh the login shell: chsh -s $(command -v zsh)"
fi

log "next: open nvim once so lazy.nvim and mason install plugins/LSPs"
if [ -x "$HOME/bin/godbg" ]; then
	log "godbg is at ~/bin/godbg (run 'godbg doctor' to verify its dependencies)"
else
	warn "godbg is not installed; review the warning above and re-run this script"
fi

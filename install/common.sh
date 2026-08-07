#!/usr/bin/env bash
# Shared helpers for the dotfiles installers. Sourced, not executed.

set -euo pipefail

DOTFILES_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

log() { printf '==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() {
	printf 'error: %s\n' "$*" >&2
	exit 1
}

have() { command -v "$1" >/dev/null 2>&1; }

# link <repo-relative-source> <absolute-destination>
#
# Creates dest as a symlink to the repo copy. An existing file or directory is
# moved aside to <dest>.bak-<timestamp> instead of being deleted, so nothing is
# lost when adopting the repo on a machine that already has configs.
link() {
	local src="$DOTFILES_ROOT/$1"
	local dest="$2"

	[ -e "$src" ] || die "missing source in repo: $src"
	mkdir -p "$(dirname "$dest")"

	if [ -L "$dest" ]; then
		if [ "$(readlink "$dest")" = "$src" ]; then
			log "ok $dest"
			return 0
		fi
		rm "$dest"
	elif [ -e "$dest" ]; then
		local backup="$dest.bak-$STAMP" suffix=1
		while [ -e "$backup" ] || [ -L "$backup" ]; do
			backup="$dest.bak-$STAMP-$suffix"
			((suffix += 1))
		done
		log "backup $dest -> $backup"
		mv "$dest" "$backup"
	fi

	ln -s "$src" "$dest"
	log "link $dest -> $src"
}

# install_godbg
#
# Installs the Go debugger TUI from its public repository and installs the Delve
# version it needs. godbg refuses to start when dlv is missing or older than the
# installed Go toolchain, so both are handled here rather than at first run.
install_godbg() {
	if ! have go; then
		warn "go is not installed; skipping godbg (run install again after installing Go)"
		return 0
	fi

	local gobin="$HOME/bin"
	mkdir -p "$gobin"
	log "installing godbg -> $gobin/godbg"
	GOBIN="$gobin" go install github.com/erazemkos/godbg/cmd/godbg@latest ||
		{ warn "godbg install failed; the rest of the install continues"; return 0; }

	# Delve refuses to debug a Go toolchain newer than it supports, so install the
	# latest release in $HOME/go/bin. Mason's copy (used by nvim-dap) is untouched.
	log "installing latest delve (dlv)"
	GOFLAGS=-mod=mod go install github.com/go-delve/delve/cmd/dlv@latest ||
		warn "could not install dlv; godbg will report it at startup"
}

# install_pi_packages
#
# Materializes Git-backed packages declared in the linked Pi settings. npm-backed
# packages are installed with Pi itself; this keeps standalone personal packages
# out of the dotfiles checkout.
install_pi_packages() {
	local pi_bin
	if have pi; then
		pi_bin="$(command -v pi)"
	elif [ -x "$HOME/.local/bin/pi" ]; then
		# Debian installs Pi into a user-owned prefix that may not be on this
		# bootstrap process's PATH yet.
		pi_bin="$HOME/.local/bin/pi"
	else
		warn "pi is not installed; skipping Pi packages"
		return 0
	fi

	local grill_ref="a2412dd610e97a875b94e8e743becf5695c6dce8"
	log "installing pi-grill-wizard@$grill_ref"
	"$pi_bin" install "git:github.com/erazemkos/pi-grill-wizard@$grill_ref" ||
		warn "could not install pi-grill-wizard; re-run this installer after checking GitHub access"
}

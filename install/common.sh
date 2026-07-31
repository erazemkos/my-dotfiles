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
		local backup="$dest.bak-$STAMP"
		log "backup $dest -> $backup"
		mv "$dest" "$backup"
	fi

	ln -s "$src" "$dest"
	log "link $dest -> $src"
}

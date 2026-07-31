#!/usr/bin/env bash
# Debian/Ubuntu bootstrap: install every dependency these configs need, then
# link them. Packages come from apt where a usable version exists; the rest are
# installed from upstream release binaries.
# Usage: install/debian.sh

set -euo pipefail
# shellcheck source=install/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

have apt-get || die "this script needs apt (Debian/Ubuntu); use install/macos.sh on macOS"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
	have sudo || die "sudo is required (or run as root)"
	SUDO="sudo"
fi

DEB_ARCH="$(dpkg --print-architecture)"
case "$DEB_ARCH" in
amd64) UNAME_ARCH="x86_64" ;;
arm64) UNAME_ARCH="aarch64" ;;
*) die "unsupported architecture: $DEB_ARCH" ;;
esac

BIN_DIR="/usr/local/bin"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

APT_PACKAGES=(
	build-essential # nvim treesitter parsers, telescope-fzf-native
	ca-certificates
	curl
	wget
	git
	unzip
	tar
	fontconfig
	zsh
	ripgrep    # telescope live_grep
	fd-find    # telescope find_files (binary is fdfind)
	fzf
	jq
	autojump   # oh-my-zsh autojump plugin
	poppler-utils
	ffmpeg
	imagemagick
	p7zip-full
	kitty
	golang-go  # gopls/goimports/delve builds
	python3
	python3-venv
)

log "apt update"
$SUDO apt-get update -y

log "installing apt packages"
$SUDO apt-get install -y --no-install-recommends "${APT_PACKAGES[@]}"

# zoxide and git-delta are only in recent Debian/Ubuntu releases.
for optional in zoxide git-delta; do
	if $SUDO apt-get install -y --no-install-recommends "$optional" 2>/dev/null; then
		log "installed $optional from apt"
	else
		warn "$optional not available from apt; install manually (cargo install $optional)"
	fi
done

# apt ships fd as `fdfind`; nvim/telescope and muscle memory expect `fd`.
if have fdfind && ! have fd; then
	log "linking fdfind -> $BIN_DIR/fd"
	$SUDO ln -sf "$(command -v fdfind)" "$BIN_DIR/fd"
fi

github_latest_tag() {
	curl -fsSL "https://api.github.com/repos/$1/releases/latest" | jq -r .tag_name
}

# --- Neovim -----------------------------------------------------------------
# This config is Kickstart-based and needs a recent Neovim; distro packages are
# frequently too old, so install the official tarball when that is the case.
nvim_too_old() {
	have nvim || return 0
	local version
	version="$(nvim --version | head -1 | sed 's/^NVIM v//')"
	[ "$(printf '%s\n0.11.0\n' "$version" | sort -V | head -1)" != "0.11.0" ]
}

if nvim_too_old; then
	log "installing Neovim from upstream release"
	case "$UNAME_ARCH" in
	x86_64) nvim_asset="nvim-linux-x86_64.tar.gz" ;;
	aarch64) nvim_asset="nvim-linux-arm64.tar.gz" ;;
	esac
	curl -fsSL -o "$TMP/nvim.tar.gz" \
		"https://github.com/neovim/neovim/releases/latest/download/$nvim_asset"
	$SUDO rm -rf /opt/nvim
	$SUDO mkdir -p /opt/nvim
	$SUDO tar -xzf "$TMP/nvim.tar.gz" -C /opt/nvim --strip-components=1
	$SUDO ln -sf /opt/nvim/bin/nvim "$BIN_DIR/nvim"
else
	log "ok neovim $(nvim --version | head -1)"
fi

# --- Node.js ----------------------------------------------------------------
# mason (ts_ls, pyright, cssls, html) and pi both need a modern Node.
node_major() { node --version 2>/dev/null | sed 's/^v//; s/\..*//'; }

if ! have node || [ "$(node_major)" -lt 20 ]; then
	log "installing Node.js 22 from NodeSource"
	curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
	$SUDO apt-get install -y nodejs
else
	log "ok node $(node --version)"
fi

# --- lazygit ----------------------------------------------------------------
if have lazygit; then
	log "ok lazygit $(lazygit --version | head -1)"
else
	log "installing lazygit from upstream release"
	lg_tag="$(github_latest_tag jesseduffield/lazygit)"
	lg_version="${lg_tag#v}"
	case "$UNAME_ARCH" in
	x86_64) lg_arch="x86_64" ;;
	aarch64) lg_arch="arm64" ;;
	esac
	curl -fsSL -o "$TMP/lazygit.tar.gz" \
		"https://github.com/jesseduffield/lazygit/releases/download/${lg_tag}/lazygit_${lg_version}_Linux_${lg_arch}.tar.gz"
	tar -xzf "$TMP/lazygit.tar.gz" -C "$TMP" lazygit
	$SUDO install -m 0755 "$TMP/lazygit" "$BIN_DIR/lazygit"
fi

# --- yazi -------------------------------------------------------------------
if have yazi; then
	log "ok yazi $(yazi --version)"
else
	log "installing yazi from upstream release"
	yz_tag="$(github_latest_tag sxyazi/yazi)"
	curl -fsSL -o "$TMP/yazi.deb" \
		"https://github.com/sxyazi/yazi/releases/download/${yz_tag}/yazi-${UNAME_ARCH}-unknown-linux-gnu.deb"
	$SUDO apt-get install -y "$TMP/yazi.deb"
fi

# --- herdr -----------------------------------------------------------------
if have herdr; then
	log "ok herdr $(herdr --version 2>/dev/null || echo installed)"
else
	log "installing herdr from upstream release"
	hd_tag="$(github_latest_tag herdrdev/herdr)"
	curl -fsSL -o "$TMP/herdr" \
		"https://github.com/herdrdev/herdr/releases/download/${hd_tag}/herdr-linux-${UNAME_ARCH}"
	$SUDO install -m 0755 "$TMP/herdr" "$BIN_DIR/herdr"
fi

# --- GitHub CLI -------------------------------------------------------------
if have gh; then
	log "ok gh $(gh --version | head -1)"
else
	log "installing GitHub CLI"
	curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg |
		$SUDO dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg >/dev/null
	$SUDO chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
	echo "deb [arch=$DEB_ARCH signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" |
		$SUDO tee /etc/apt/sources.list.d/github-cli.list >/dev/null
	$SUDO apt-get update -y
	$SUDO apt-get install -y gh
fi

# --- global npm packages ----------------------------------------------------
log "installing global npm packages"
$SUDO npm install -g @earendil-works/pi-coding-agent hunkdiff

# --- Nerd Font --------------------------------------------------------------
FONT_DIR="$HOME/.local/share/fonts"
if ls "$FONT_DIR"/JetBrainsMono*NerdFont* >/dev/null 2>&1; then
	log "ok JetBrainsMono Nerd Font"
else
	log "installing JetBrainsMono Nerd Font (kitty.conf font_family)"
	mkdir -p "$FONT_DIR"
	curl -fsSL -o "$TMP/JetBrainsMono.zip" \
		"https://github.com/ryanoasis/nerd-fonts/releases/latest/download/JetBrainsMono.zip"
	unzip -qo "$TMP/JetBrainsMono.zip" -d "$FONT_DIR/JetBrainsMono"
	fc-cache -f "$FONT_DIR" >/dev/null
fi

# --- oh-my-zsh + plugins ----------------------------------------------------
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

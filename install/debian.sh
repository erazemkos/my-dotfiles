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
amd64)
	UNAME_ARCH="x86_64"
	MUSL_TARGET="x86_64-unknown-linux-musl"
	DELTA_TARGET="$MUSL_TARGET"
	KITTY_ARCH="x86_64"
	;;
arm64)
	UNAME_ARCH="aarch64"
	MUSL_TARGET="aarch64-unknown-linux-musl"
	# git-delta does not publish an aarch64 musl archive.
	DELTA_TARGET="aarch64-unknown-linux-gnu"
	KITTY_ARCH="arm64"
	;;
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
	file       # file type detection in yazi
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
	python3
	python3-venv
)

log "apt update"
$SUDO apt-get update -y

log "installing apt packages"
$SUDO apt-get install -y --no-install-recommends "${APT_PACKAGES[@]}"

# apt ships fd as `fdfind`; nvim/telescope and muscle memory expect `fd`.
# Check the persistent target rather than PATH, which pi may temporarily add
# its own private fd binary to while this installer is running.
if have fdfind && [ ! -x "$BIN_DIR/fd" ]; then
	log "linking fdfind -> $BIN_DIR/fd"
	$SUDO ln -sf "$(command -v fdfind)" "$BIN_DIR/fd"
fi

github_latest_tag() {
	curl -fsSL "https://api.github.com/repos/$1/releases/latest" | jq -r .tag_name
}

version_lt() {
	[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" != "$2" ]
}

# --- Neovim -----------------------------------------------------------------
# This config is Kickstart-based and needs a recent Neovim; distro packages are
# frequently too old, so install the official tarball when that is the case.
nvim_too_old() {
	have nvim || return 0
	local version
	version="$(nvim --version | head -1 | sed 's/^NVIM v//')"
	version_lt "$version" 0.11.0
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

# --- Kitty ------------------------------------------------------------------
# Debian 11's Kitty is too old for options used by kitty.conf, so use the
# self-contained upstream build on old distributions.
kitty_too_old() {
	have kitty || return 0
	local output version
	output="$(kitty --version 2>/dev/null)" || return 0
	version="$(printf '%s' "$output" | awk '{ print $2 }')"
	[ -n "$version" ] || return 0
	version_lt "$version" 0.30.0
}

if kitty_too_old; then
	log "installing Kitty from upstream release"
	# Newer builds require glibc 2.35, but Debian 11 provides 2.31. This is the
	# newest release tested on Bullseye and supports every option in kitty.conf.
	kt_version="0.42.2"
	kt_tag="v$kt_version"
	curl -fsSL -o "$TMP/kitty.txz" \
		"https://github.com/kovidgoyal/kitty/releases/download/${kt_tag}/kitty-${kt_version}-${KITTY_ARCH}.txz"
	$SUDO rm -rf /opt/kitty
	$SUDO mkdir -p /opt/kitty
	$SUDO tar -xJf "$TMP/kitty.txz" -C /opt/kitty
	$SUDO ln -sf /opt/kitty/bin/kitty "$BIN_DIR/kitty"
	$SUDO ln -sf /opt/kitty/bin/kitten "$BIN_DIR/kitten"
else
	log "ok $(kitty --version)"
fi

# --- Node.js ----------------------------------------------------------------
# mason (ts_ls, pyright, cssls, html) and pi both need a modern Node.
node_major() { node --version 2>/dev/null | sed 's/^v//; s/\..*//'; }

if ! have node || [ "$(node_major)" -lt 20 ]; then
	log "installing Node.js 22 from NodeSource"
	if [ -n "$SUDO" ]; then
		curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
	else
		curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
	fi
	$SUDO apt-get install -y nodejs
else
	log "ok node $(node --version)"
fi

# --- Go ---------------------------------------------------------------------
# Bullseye ships Go 1.15, which cannot build current gopls/goimports/delve.
go_too_old() {
	have go || return 0
	local version
	version="$(go version | sed -E 's/.* go([0-9]+(\.[0-9]+){1,2}).*/\1/')"
	version_lt "$version" 1.25.0
}

if go_too_old; then
	log "installing Go from the latest stable upstream release"
	go_releases="$(curl -fsSL 'https://go.dev/dl/?mode=json')"
	go_file="$(printf '%s' "$go_releases" | jq -r --arg arch "$DEB_ARCH" \
		'first(.[] | select(.stable) | .files[] | select(.os == "linux" and .arch == $arch and .kind == "archive") | .filename)')"
	[ -n "$go_file" ] && [ "$go_file" != null ] || die "could not find a Go release for $DEB_ARCH"
	curl -fsSL -o "$TMP/$go_file" "https://go.dev/dl/$go_file"
	$SUDO rm -rf /usr/local/go
	$SUDO tar -xzf "$TMP/$go_file" -C /usr/local
	$SUDO ln -sf /usr/local/go/bin/go "$BIN_DIR/go"
	$SUDO ln -sf /usr/local/go/bin/gofmt "$BIN_DIR/gofmt"
else
	log "ok $(go version)"
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

# --- zoxide -----------------------------------------------------------------
if have zoxide; then
	log "ok zoxide $(zoxide --version)"
else
	log "installing zoxide from upstream release"
	zx_tag="$(github_latest_tag ajeetdsouza/zoxide)"
	zx_version="${zx_tag#v}"
	curl -fsSL -o "$TMP/zoxide.tar.gz" \
		"https://github.com/ajeetdsouza/zoxide/releases/download/${zx_tag}/zoxide-${zx_version}-${MUSL_TARGET}.tar.gz"
	tar -xzf "$TMP/zoxide.tar.gz" -C "$TMP"
	$SUDO install -m 0755 "$TMP/zoxide" "$BIN_DIR/zoxide"
fi

# --- git-delta --------------------------------------------------------------
if have delta; then
	log "ok delta $(delta --version)"
else
	log "installing git-delta from upstream release"
	delta_tag="$(github_latest_tag dandavison/delta)"
	delta_version="${delta_tag#v}"
	delta_dir="delta-${delta_version}-${DELTA_TARGET}"
	curl -fsSL -o "$TMP/delta.tar.gz" \
		"https://github.com/dandavison/delta/releases/download/${delta_tag}/${delta_dir}.tar.gz"
	tar -xzf "$TMP/delta.tar.gz" -C "$TMP"
	$SUDO install -m 0755 "$TMP/$delta_dir/delta" "$BIN_DIR/delta"
fi

# --- yazi -------------------------------------------------------------------
if have yazi && have ya; then
	log "ok yazi $(yazi --version)"
else
	log "installing yazi from upstream release"
	yz_tag="$(github_latest_tag sxyazi/yazi)"
	yz_dir="yazi-${MUSL_TARGET}"
	curl -fsSL -o "$TMP/yazi.zip" \
		"https://github.com/sxyazi/yazi/releases/download/${yz_tag}/${yz_dir}.zip"
	unzip -q "$TMP/yazi.zip" -d "$TMP"
	$SUDO install -m 0755 "$TMP/$yz_dir/yazi" "$BIN_DIR/yazi"
	$SUDO install -m 0755 "$TMP/$yz_dir/ya" "$BIN_DIR/ya"
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
# A user-owned prefix works with both NodeSource and nvm, and avoids running
# third-party npm lifecycle scripts as root. ~/.local/bin is in zsh/zshrc.
log "installing global npm packages under $HOME/.local"
npm install -g --prefix "$HOME/.local" \
	@earendil-works/pi-coding-agent hunkdiff

# --- tree-sitter CLI --------------------------------------------------------
# Current upstream Linux binaries require a newer glibc than Debian 11. Build
# the CLI locally with Rust so it runs on the installed distribution. Version
# 0.25.10 satisfies nvim-treesitter without the extra libclang build dependency
# introduced by tree-sitter-cli 0.26.
TREE_SITTER_CLI_VERSION="0.25.10"
tree_sitter_ok() {
	have tree-sitter || return 1
	local version
	version="$(tree-sitter --version 2>/dev/null | awk '{ print $2 }')"
	[ -n "$version" ] && ! version_lt "$version" 0.25.0
}

if tree_sitter_ok; then
	log "ok tree-sitter $(tree-sitter --version)"
else
	if [ ! -x "$HOME/.cargo/bin/rustup" ]; then
		log "installing a minimal Rust toolchain for tree-sitter-cli"
		curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs -o "$TMP/rustup.sh"
		sh "$TMP/rustup.sh" -y --profile minimal --no-modify-path
	fi
	log "updating the Rust toolchain used to build tree-sitter-cli"
	"$HOME/.cargo/bin/rustup" toolchain install stable --profile minimal --no-self-update
	"$HOME/.cargo/bin/rustup" default stable
	log "building tree-sitter-cli $TREE_SITTER_CLI_VERSION (this can take a few minutes)"
	"$HOME/.cargo/bin/cargo" install --version "$TREE_SITTER_CLI_VERSION" \
		--locked --force --root "$HOME/.local" tree-sitter-cli
fi

# --- Nerd Font --------------------------------------------------------------
FONT_DIR="$HOME/.local/share/fonts"
if [ -d "$FONT_DIR" ] && find "$FONT_DIR" -type f -iname 'JetBrainsMono*NerdFont*' -print -quit | grep -q .; then
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
	RUNZSH=no CHSH=no KEEP_ZSHRC=yes sh -c \
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

install_godbg

"$DOTFILES_ROOT/install/link.sh"
install_pi_packages

if [ "${SHELL:-}" != "$(command -v zsh)" ]; then
	log "to make zsh the login shell: chsh -s $(command -v zsh)"
fi

log "next: open nvim once so lazy.nvim and mason install plugins/LSPs"
if [ -x "$HOME/bin/godbg" ]; then
	log "godbg is at ~/bin/godbg (run 'godbg doctor' to verify its dependencies)"
else
	warn "godbg is not installed; review the install warning above and re-run this script"
fi

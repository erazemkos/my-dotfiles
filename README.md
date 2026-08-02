# dotfiles

Personal configs for Neovim, Kitty, Herdr, lazygit, pi and zsh, plus install
scripts that pull in every dependency they need.

## Layout

```
nvim/      Neovim config (Kickstart-based, lazy.nvim + mason)
kitty/     kitty.conf and the Desert theme it includes
herdr/     Herdr config.toml (theme, prefix keys, pane/tab bindings)
lazygit/   lazygit config.yml (delta pager, hunk custom command)
pi/        pi agent config: settings, theme, prompts, agents, extension, skills
pi/scripts/ helper scripts used by pi skills (linked to ~/.pi/agent/scripts)
zsh/       zshrc and zprofile
install/   bootstrap scripts
```

## Install

```bash
git clone https://github.com/erazemkos/my-dotfiles.git ~/.config/dotfiles

~/.config/dotfiles/install/macos.sh    # macOS (Homebrew)
~/.config/dotfiles/install/debian.sh   # Debian/Ubuntu (apt + upstream releases)
```

Both scripts install dependencies and then run `install/link.sh`, which
symlinks each config into place. The Debian script asks for your `sudo`
password for system packages and `/usr/local` tools; npm packages and fonts are
installed under your home directory. Re-running is safe: an existing file or
directory is moved to `<path>.bak-<timestamp>` before the symlink is created,
and links that already point at the repo are left alone.

`install/link.sh` can be run on its own if the dependencies are already there.

## Where things get linked

| Repo path                            | Destination                                                          |
| ------------------------------------ | -------------------------------------------------------------------- |
| `nvim/`                              | `~/.config/nvim`                                                     |
| `kitty/`                             | `~/.config/kitty`                                                    |
| `herdr/config.toml`                  | `~/.config/herdr/config.toml`                                        |
| `lazygit/config.yml`                 | macOS: `~/Library/Application Support/lazygit/config.yml`             |
|                                      | Linux: `~/.config/lazygit/config.yml`                                 |
| `zsh/zshrc`, `zsh/zprofile`          | `~/.zshrc`, `~/.zprofile`                                            |
| `pi/settings.json`                   | `~/.pi/agent/settings.json`                                          |
| `pi/themes/`, `pi/prompts/`, ...     | matching files under `~/.pi/agent/`                                  |
| `pi/skills/video`                    | `~/.pi/agent/skills/video`                                           |
| `pi/scripts/`                        | `~/.pi/agent/scripts`                                                |

Herdr and pi keep runtime state (sockets, logs, session transcripts,
credentials) next to their config, so only individual config files are linked
there — never the whole directory.

## Dependencies

Installed by the bootstrap scripts:

- **Editor/terminal:** neovim (0.11+), kitty (0.30+), JetBrainsMono Nerd Font,
  herdr
- **Neovim runtime needs:** git, make/build tools, ripgrep, fd, node, modern Go,
  python3, tree-sitter
- **Git tooling:** git-delta (the lazygit pager), lazygit, `hunkdiff` (`hunk`,
  used by the lazygit custom command), gh
- **Shell:** zsh, oh-my-zsh + `zsh-autosuggestions` and
  `zsh-syntax-highlighting`, autojump, zoxide, fzf, jq
- **File manager:** yazi (`y` function in `.zshrc`, yazi.nvim) with ffmpeg,
  poppler, imagemagick, 7zip preview backends
- **Agents:** pi (`@earendil-works/pi-coding-agent`)

Neovim's LSP servers and formatters (gopls, ts_ls, pyright, lua_ls, html,
cssls, templ, stylua, prettier, goimports, delve) are installed by mason on
first launch, so open `nvim` once after bootstrapping.

## Notes

- On WSL, Kitty needs WSLg (Windows 11 or a current WSL installation). The font
  is installed inside Linux, so it applies to Linux GUI applications rather
  than Windows Terminal.
- `pi` rewrites `~/.pi/agent/settings.json` when you change model or theme from
  inside the app; commit the resulting change here.
- `pi/settings.json` defaults to Amazon Bedrock and also lists machine-local
  `bedrock-mantle` models. On a fresh machine, configure AWS credentials or
  pick an available provider with `/model`.
- Neovim's `lazy-lock.json` is intentionally not tracked (see `nvim/.gitignore`).

# dotfiles

Personal configs for Neovim, Kitty, Herdr, lazygit, pi and zsh, plus install
scripts that pull in every dependency they need.

## Layout

```
nvim/      Neovim config (Kickstart-based, lazy.nvim + mason)
kitty/     kitty.conf and the Desert theme it includes
herdr/     Herdr config.toml (theme, prefix keys, pane/tab bindings)
lazygit/   lazygit config.yml (delta pager, hunk custom command)
godbg/     godbg config (app source: github.com/erazemkos/godbg)
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
| `godbg/config.yml`                   | `~/.config/godbg/config.yml`                                          |
| `zsh/zshrc`, `zsh/zprofile`          | `~/.zshrc`, `~/.zprofile`                                            |
| `pi/settings.json`                   | `~/.pi/agent/settings.json`                                          |
| `pi/keybindings.json`                | `~/.pi/agent/keybindings.json`                                       |
| `pi/themes/`, `pi/prompts/`, ...     | matching files under `~/.pi/agent/`                                  |
| `pi/skills/video`                    | `~/.pi/agent/skills/video`                                           |
| `pi/scripts/`                        | `~/.pi/agent/scripts`                                                |

Herdr, pi and godbg keep runtime state (sockets, logs, session transcripts,
credentials, per-project breakpoints) next to their config or under
`~/.local/state`, so only individual config files are linked there — never the
whole directory.

Bootstrap scripts install `godbg` from
[github.com/erazemkos/godbg](https://github.com/erazemkos/godbg) into
`~/bin/godbg` (already on `PATH` via `zsh/zshrc`) and install a current `dlv`.

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
- **Agents:** pi (`@earendil-works/pi-coding-agent`) and
  [pi-grill-wizard](https://github.com/erazemkos/pi-grill-wizard), installed as a
  Git-backed Pi package
- **Go debugger TUI:** installed from
  [github.com/erazemkos/godbg](https://github.com/erazemkos/godbg) into
  `~/bin/godbg`; installation needs Go 1.25+, while runtime debugging supports
  Go 1.21+. It also needs `dlv` new enough for that toolchain (installed into
  `~/go/bin`), neovim 0.11+ and a terminal with SGR mouse reporting. `gopls` is
  optional and only improves test discovery.

Neovim's LSP servers and formatters (gopls, ts_ls, pyright, lua_ls, html,
cssls, templ, stylua, prettier, goimports, delve) are installed by mason on
first launch, so open `nvim` once after bootstrapping.

## Notes

- On WSL, Kitty needs WSLg (Windows 11 or a current WSL installation). The font
  is installed inside Linux, so it applies to Linux GUI applications rather
  than Windows Terminal.
- `pi` rewrites `~/.pi/agent/settings.json` when you change model or theme from
  inside the app; commit the resulting change here.
- `pi/settings.json` defaults to DevRev's Arcus AI Gateway. Auth comes from the
  `ARCUS_API_KEY` environment variable, which `zsh/zshrc` populates from Keychain
  (`arcus-token`, e.g. installed by
  [Vulcan](https://github.com/devrev/vulcan)). Alternatively, run `/login`, select
  **Arcus AI Gateway**, and paste the token into pi's local auth store. Arcus models are
  refreshed from `/v1/models`; `/arcus-status` shows auth and catalog state.
- `pi/extensions/provider-profiles.ts` makes the provider the unit of work:
  `/provider [name]` (or `Ctrl+R`) picks the provider group, `/scope` chooses
  which of *that group's* models to cycle, and `Ctrl+P` cycles them without
  ever leaving the group. `PROVIDER_GROUPS` merges `amazon-bedrock` +
  `bedrock-mantle` into one `bedrock` group; when both expose the same model id
  the later member wins, so mantle's working `openai.gpt-5.6-*` replaces the
  broken Converse copies. `DEFAULT_SCOPE` starts each group with only Opus 5
  Global + GPT-5.6 Sol/Terra enabled; everything else is listed in `/scope` but
  off. Saved scope lives in `~/.pi/agent/provider-profiles.json` (per-machine
  runtime state, not in this repo). Providers appear only when their auth is
  configured. `Ctrl+L` still opens the full cross-provider picker, and built-in
  `/scoped-models` still edits pi's own cross-provider scope — it is handled
  inside pi before extension commands, so it cannot be overridden; use `/scope`
  for the per-group list.
- `pi/keybindings.json` clears the built-in bindings that would otherwise claim
  the extension's keys, so it must stay linked alongside
  `pi/extensions/provider-profiles.ts`:
  | id | change | why |
  | -- | ------ | --- |
  | `app.model.cycleForward` / `app.model.cycleBackward` | unbound | reserved ids; while bound, pi *skips* an extension shortcut on `Ctrl+P` / `Shift+Ctrl+P` entirely |
  | `app.session.togglePath` | unbound | also held `Ctrl+P`; only toggled path display in `/resume` |
  | `app.models.toggleProvider` | unbound | also held `Ctrl+P`; belonged to built-in `/scoped-models`, superseded by `/scope` |
  | `app.session.rename` | moved to `F2` | held `Ctrl+R`; rename-from-`/resume` has no other entry point (`/name` only renames the current session) |
  Without the two `unbound` entries on `Ctrl+P`, pi prints an
  `[Extension issues]` shortcut-conflict warning on every start and `/reload` —
  `quietStartup` does *not* suppress those. The unbound picker actions still
  render their hint text in `/resume` and `/scoped-models`, just with an empty
  key.
- Provider cycling is bound to **`Ctrl+R`** as well as `Shift+Ctrl+P`, because
  kitty's default `kitty_mod+p` (= `ctrl+shift+p`) is a multi-key *prefix* for
  its `hints`/`choose-files` kittens: the first press is swallowed by kitty's
  pending-sequence mode, so only a double press reaches pi. To reclaim
  `Shift+Ctrl+P` instead, unmap the prefix leaves in `kitty/kitty.conf`
  (`map kitty_mod+p>f`, `>shift+f`, `>c`, `>d`, `>l`, `>w`, `>h`, `>n`, `>y`
  with no action), at the cost of kitty's hint-insertion features.
- `pi/extensions/bedrock-sso.ts` keeps `amazon-bedrock` authenticated by
  refreshing AWS SSO credentials into the process env at session start, and
  `pi/extensions/bedrock-mantle.ts` registers the `bedrock-mantle` provider
  (GPT-5.x / Grok, served from Bedrock's OpenAI-compatible endpoint through a
  local SigV4 proxy). Both need working AWS credentials/SSO; without them those
  two providers stay unavailable while the gateway providers keep working.
- [godbg](https://github.com/erazemkos/godbg) is a mouse-first terminal debugger
  for Go: Delve over DAP, a GoLand keymap, and Neovim embedded in its source
  panel (`nvim --embed` attached as a Neovim UI, so the code shows your
  colorscheme, treesitter and LSP colors). Two details matter for this setup:
  - It **does not change** `nvim/lua/kickstart/plugins/debug.lua`; nvim-dap keeps
    F1–F7 in a standalone Neovim. godbg unmaps those keys only inside the Neovim
    instance it spawns, so the same F-keys mean the same thing in both panes.
    Debugging one binary with godbg and nvim-dap at the same time would start two
    Delve processes — pick one.
  - `editor.mode: integrated` (the default) embeds Neovim in godbg's own window;
    keys go to Neovim while the source panel has focus, except the debugger
    chords. `editor.mode: pane` keeps the old sibling pane, created through herdr
    (`herdr pane split`) or kitty remote control (already enabled by
    `kitty/kitty.conf`), positioned with `editor.panePosition`; elsewhere run
    `nvim --listen <socket>` yourself and export `GODBG_NVIM_SOCKET`, or set
    `editor: {enabled: false}`.
  - Herdr owns plain right-click for its pane menu, so `herdr/config.toml` sets
    `right_click_passthrough_modifier = "alt"`: **Alt+right-click** reaches
    godbg's context menus. godbg also puts a clickable `⋯` at the end of each
    row and binds a menu key (`Shift+F10`, fallback `m`), so right-click is
    never required.
- `godbg` opens on its Targets tab, which merges `.vscode/launch.json` Go
  configurations with the module's main and test packages; `godbg targets` prints
  the same list without starting the UI.
- godbg keys follow GoLand. In kitty the literal chords work (Shift+F8,
  Ctrl+F8, …); in terminals without the kitty keyboard protocol godbg switches to
  documented fallbacks (`f6`, `b`, `x`, `r`). `godbg keys` prints the effective
  map, `F1` shows it in the app, and `godbg doctor` checks dependencies.
- Neovim's `lazy-lock.json` is intentionally not tracked (see `nvim/.gitignore`).

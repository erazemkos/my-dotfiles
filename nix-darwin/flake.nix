{
  description = "Example nix-darwin system flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin.url = "github:LnL7/nix-darwin";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = inputs@{ self, nix-darwin, nixpkgs }:
  let
    configuration = { pkgs, ... }: {
      # List packages installed in system profile. To search by name, run:
      # $ nix-env -qaP | grep wget
      environment.systemPackages =
        [ pkgs.vim
        ];

      # Necessary for using flakes on this system.
      nix.settings.experimental-features = "nix-command flakes";

      # Enable alternative shell support in nix-darwin.
      # programs.fish.enable = true;

      # Set Git commit hash for darwin-version.
      system.configurationRevision = self.rev or self.dirtyRev or null;

      # Used for backwards compatibility, please read the changelog before changing.
      # $ darwin-rebuild changelog
      system.stateVersion = 5;

      # The platform the configuration will be used on.
      nixpkgs.hostPlatform = "aarch64-darwin";
      security.pam.enableSudoTouchIdAuth = true;

      system.defaults = {
          dock.autohide = true;
          dock.mru-spaces = false;
          finder.AppleShowAllExtensions = true;
          screencapture.location = "~/Pictures/screenshots";
      };

      homebrew.enable = true;
      homebrew.brews = [
        "autojump"
        "awscli"
        "brotli"
        "btop"
        "c-ares"
        "ca-certificates"
        "cffi"
        "cryptography"
        "delve"
        "gettext"
        "go"
        "icu4c@76"
        "jq"
        "lazygit"
        "libgit2"
        "libnghttp2"
        "libssh2"
        "libunistring"
        "libuv"
        "libvterm"
        "llvm"
        "lpeg"
        "luajit"
        "luv"
        "lz4"
        "mpdecimal"
        "msgpack"
        "neofetch"
        "neovim"
        "nushell"
        "node"
        "oniguruma"
        "openssl@3"
        "pcre2"
        "pkgconf"
        "pycparser"
        "python@3.13"
        "readline"
        "ripgrep"
        "rust"
        "screenresolution"
        "sketchybar"
        "snyk-cli"
        "sqlite"
        "tree-sitter"
        "unibilium"
        "xz"
        "z3"
        "zstd"
        "wget"
      ];

      homebrew.casks = [
        "aerospace"
        "font-sf-pro"
        "scroll-reverser"
        "font-jetbrains-mono-nerd-font"
        "jandedobbeleer/oh-my-posh/oh-my-posh"
      ];
    };
  in
  {
    # Build darwin flake using:
    # $ darwin-rebuild build --flake .#Erazems-MacBook-Pro
    darwinConfigurations."Erazems-MacBook-Pro" = nix-darwin.lib.darwinSystem {
      modules = [ configuration ];
    };
  };
}

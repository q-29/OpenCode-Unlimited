#!/usr/bin/env bash
set -e

# macOS-only installer for OpenCode-Unlimited.
# No admin rights, no registry writes, no global proxy changes.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$SCRIPT_DIR/bin"
ENTRY="$BIN_DIR/opencode-unlimited"
PLUGIN_SRC="$SCRIPT_DIR/plugins/unlimited-shield.js"
BRIDGE_SRC="$SCRIPT_DIR/lib/proxy-bridge.js"

USER_HOME="${HOME:-~}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$USER_HOME/.config}/opencode"
PLUGIN_DIR="$CONFIG_DIR/plugins"
PLUGIN_FOLDER="$PLUGIN_DIR/unlimited-shield"
PLUGIN_DST="$PLUGIN_FOLDER/index.js"

ok() { printf "  \033[32m[+]\033[0m %s\n" "$1"; }
bad() { printf "  \033[31m[x]\033[0m %s\n" "$1"; exit 1; }
info() { printf "      \033[90m%s\033[0m\n" "$1"; }

printf "==> opencode-unlimited install (macOS)\n"

if [ "$(uname -s)" != "Darwin" ]; then
  bad "this build targets macOS only (detected $(uname -s))"
fi
ok "macOS detected: $(sw_vers -productVersion 2>/dev/null || uname -r)"

# Verify build artifacts
for file in "$ENTRY" "$PLUGIN_SRC" "$BRIDGE_SRC"; do
  if [ ! -f "$file" ]; then
    bad "missing build artifact: $file"
  fi
done
ok "build artifacts present"

# Make CLI executable
chmod +x "$ENTRY"
ok "cli executable set"

# Check node >= 22.5 (node:sqlite)
if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node --version 2>/dev/null || true)"
  NODE_MAJOR="$(printf '%s' "$NODE_VER" | sed -E 's/^v?([0-9]+).*/\1/')"
  NODE_MINOR="$(printf '%s' "$NODE_VER" | sed -E 's/^v?[0-9]+\.([0-9]+).*/\1/')"
  if [ "${NODE_MAJOR:-0}" -gt 22 ] || { [ "${NODE_MAJOR:-0}" -eq 22 ] && [ "${NODE_MINOR:-0}" -ge 5 ]; }; then
    ok "node $NODE_VER"
  else
    bad "node $NODE_VER is too old, need 22.5+ for node:sqlite (install via: brew install node)"
  fi
else
  bad "node not found, install via: brew install node"
fi

# Check curl (ships with macOS)
if command -v curl >/dev/null 2>&1; then
  ok "curl $(curl --version 2>/dev/null | head -n1 | awk '{print $2}')"
else
  bad "curl not found (expected at /usr/bin/curl on macOS)"
fi

# Deploy plugin
mkdir -p "$PLUGIN_FOLDER"
cp -f "$PLUGIN_SRC" "$PLUGIN_DST"
ok "plugin deployed: $PLUGIN_DST"

# Configure PATH: symlink into a bin dir that is usually on PATH,
# and append the repo bin dir to the shell profile as a fallback.
NO_PATH=0
for arg in "$@"; do
  if [ "$arg" = "--no-path" ] || [ "$arg" = "-NoPath" ]; then
    NO_PATH=1
  fi
done

if [ "$NO_PATH" -eq 0 ]; then
  LINK_DIR=""
  for candidate in "$USER_HOME/.local/bin" "/opt/homebrew/bin" "/usr/local/bin"; do
    if [ -d "$candidate" ] && [ -w "$candidate" ]; then
      LINK_DIR="$candidate"
      break
    fi
  done
  if [ -n "$LINK_DIR" ]; then
    ln -sf "$ENTRY" "$LINK_DIR/opencode-unlimited" 2>/dev/null && ok "symlinked to $LINK_DIR/opencode-unlimited" || true
  fi

  case ":$PATH:" in
    *":$BIN_DIR:"*)
      info "already on PATH: $BIN_DIR"
      ;;
    *)
      PROFILE=""
      if [ -n "$ZSH_VERSION" ] || [ "$(basename "$SHELL" 2>/dev/null || echo "")" = "zsh" ]; then
        PROFILE="$USER_HOME/.zshrc"
      elif [ -f "$USER_HOME/.bash_profile" ]; then
        PROFILE="$USER_HOME/.bash_profile"
      elif [ -f "$USER_HOME/.bashrc" ]; then
        PROFILE="$USER_HOME/.bashrc"
      else
        PROFILE="$USER_HOME/.profile"
      fi
      if [ -n "$PROFILE" ]; then
        if ! grep -q "$BIN_DIR" "$PROFILE" 2>/dev/null; then
          printf '\n# OpenCode-Unlimited\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$PROFILE"
          ok "added to PATH in $PROFILE: $BIN_DIR"
          info "open a new terminal or run 'source $PROFILE' to pick it up"
        else
          info "already configured in $PROFILE"
        fi
      fi
      ;;
  esac
fi

# Run setup through CLI
"$ENTRY" install

printf "\n  \033[36mnext:\033[0m\n"
info "opencode-unlimited status     identity, plugin, network, bucket"
info "opencode-unlimited on         full auto: identity, route, sessions, watcher"
info "opencode-unlimited test       probe the bucket on this IP (free)"
info "opencode-unlimited proxy set socks5://127.0.0.1:1080   optional IP path"
printf "\n"
ok "installed"

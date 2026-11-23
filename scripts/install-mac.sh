#!/bin/bash
# One-line Milo install/update for Macs (until the app is signed with an Apple Developer ID):
#   curl -fsSL https://raw.githubusercontent.com/jmengstrom06-lgtm/milo/main/scripts/install-mac.sh | bash
# Downloads through Terminal don't get macOS's "downloaded from the internet" tag, so there's no
# "Apple could not verify Milo" popup. Replaces any existing copy and opens the new one.
set -e
URL="https://github.com/jmengstrom06-lgtm/milo/releases/latest/download/Milo-mac-arm64.zip"
APP="/Applications/Milo.app"

if [ "$(uname -m)" != "arm64" ]; then
  echo "Sorry: this Milo build is for Apple-chip Macs (M1 or newer) only for now."
  exit 1
fi

echo "Downloading the latest Milo…"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fL --progress-bar -o "$TMP/Milo.zip" "$URL"

echo "Closing Milo if it's open…"
osascript -e 'tell application "Milo" to quit' >/dev/null 2>&1 || true
sleep 1
pkill -x Milo >/dev/null 2>&1 || true

echo "Installing…"
ditto -x -k "$TMP/Milo.zip" "$TMP/out"
if ! rm -rf "$APP" 2>/dev/null || ! ditto "$TMP/out/Milo.app" "$APP" 2>/dev/null; then
  echo "macOS wants your password to update Milo in Applications (nothing shows while you type):"
  sudo rm -rf "$APP"
  sudo ditto "$TMP/out/Milo.app" "$APP"
fi
xattr -dr com.apple.quarantine "$APP" >/dev/null 2>&1 || sudo xattr -dr com.apple.quarantine "$APP" >/dev/null 2>&1 || true

V="$(defaults read "$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo "?")"
echo "Done: Milo $V is installed. Opening it…"
open "$APP"

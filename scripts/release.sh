#!/usr/bin/env bash
set -e

# macOS release packaging: zip + tar.gz with sha256.
# Usage: RELEASE_TAG=v1.0.3 ./scripts/release.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION="${RELEASE_TAG:-0.0.0}"
VERSION="${VERSION#v}"
OUT_DIR="$ROOT/dist"
STAGE="$OUT_DIR/OpenCode-Unlimited-$VERSION"
ZIP="$OUT_DIR/OpenCode-Unlimited-$VERSION.zip"
TAR="$OUT_DIR/OpenCode-Unlimited-$VERSION.tar.gz"

rm -rf "$STAGE" "$ZIP" "$TAR"
mkdir -p "$STAGE"

for item in bin lib plugins install.sh README.md package.json LICENSE; do
  if [ -e "$ROOT/$item" ]; then
    cp -r "$ROOT/$item" "$STAGE/"
  fi
done

mkdir -p "$OUT_DIR"
(cd "$STAGE" && zip -r -q "$ZIP" .)
(cd "$STAGE" && tar -czf "$TAR" .)

HASH=$(shasum -a 256 "$ZIP" | awk '{print $1}')
SIZE=$(du -k "$ZIP" | cut -f1)

echo "artifact : $ZIP"
echo "artifact : $TAR"
echo "size     : ${SIZE} KB"
echo "sha256   : $HASH"

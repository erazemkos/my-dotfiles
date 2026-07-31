#!/usr/bin/env bash
# Render a Remotion composition to out/<name>.<ext>.
# Usage: ./scripts/render.sh <CompositionId> <outName> [extra remotion flags...]
# Run from the video/ project directory (where package.json lives).
set -euo pipefail

COMP="${1:?Usage: render.sh <CompositionId> <outName> [flags...]}"
NAME="${2:?Usage: render.sh <CompositionId> <outName> [flags...]}"
shift 2

mkdir -p out
echo "==> Rendering composition '$COMP' -> out/$NAME"
npx remotion render "$COMP" "out/$NAME" "$@"
echo "==> Done: out/$NAME"
ls -la "out/$NAME"

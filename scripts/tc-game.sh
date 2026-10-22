#!/usr/bin/env bash
# Typecheck the kit plus one game folder only: scripts/tc-game.sh <folder>
set -e
cd "$(dirname "$0")/.."
id="$1"
[ -d "src/games/$id" ] || { echo "no src/games/$id"; exit 1; }
cfg="node_modules/.cache/tsconfig.$id.json"
mkdir -p node_modules/.cache
cat > "$cfg" <<JSON
{ "extends": "../../tsconfig.json", "include": ["../../src/kit", "../../src/games/$id", "../../src/vite-env.d.ts"] }
JSON
npx tsc --noEmit -p "$cfg"
echo "typecheck ok: $id"

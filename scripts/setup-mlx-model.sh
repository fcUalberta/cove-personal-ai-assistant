#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PROJECT_DIR"
export UV_CACHE_DIR="$PROJECT_DIR/.cache/uv"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required. Install it from https://docs.astral.sh/uv/ and retry." >&2
  exit 1
fi

if [ ! -x .venv/bin/python ]; then
  uv venv --python 3.12 .venv
fi

uv pip install --python .venv/bin/python --upgrade mlx-lm

echo "Local model runtime is ready."
echo "Run: npm run model:start"

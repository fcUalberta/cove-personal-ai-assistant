#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PROJECT_DIR"

MODEL_ID=${LOCAL_LLM_MODEL:-mlx-community/Qwen3.5-9B-4bit}
MODEL_PORT=${LOCAL_LLM_PORT:-8080}

if [ ! -x .venv/bin/mlx_lm.server ]; then
  echo "Local runtime is missing. Run: npm run model:setup" >&2
  exit 1
fi

if ! .venv/bin/python -c 'import mlx.core as mx; mx.eval(mx.array([1]))' >/dev/null 2>&1; then
  echo "MLX cannot access the Mac Metal GPU from this terminal session." >&2
  echo "Run this command from a normal macOS Terminal window, not a sandboxed or remote headless process." >&2
  exit 1
fi

echo "Starting $MODEL_ID on http://127.0.0.1:$MODEL_PORT/v1"
echo "The first start downloads approximately 6 GB of model files."

exec .venv/bin/mlx_lm.server \
  --model "$MODEL_ID" \
  --host 127.0.0.1 \
  --port "$MODEL_PORT"

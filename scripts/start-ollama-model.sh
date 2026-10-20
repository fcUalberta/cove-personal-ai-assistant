#!/bin/sh
set -eu

if ! command -v ollama >/dev/null 2>&1; then
  echo "Ollama is not installed. Run: npm run model:setup" >&2
  exit 1
fi

if curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "Ollama is already running at http://127.0.0.1:11434/v1"
  exit 0
fi

echo "Starting Ollama at http://127.0.0.1:11434/v1"
exec ollama serve

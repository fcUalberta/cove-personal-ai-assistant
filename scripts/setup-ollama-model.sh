#!/bin/sh
set -eu

MODEL_ID=${LOCAL_LLM_MODEL:-llama3.1:8b}

if ! command -v ollama >/dev/null 2>&1; then
  echo "Ollama is not installed. Install it from https://ollama.com/download and retry." >&2
  exit 1
fi

if ollama list | awk 'NR > 1 { print $1 }' | grep -Fx "$MODEL_ID" >/dev/null 2>&1; then
  echo "$MODEL_ID is already installed and ready for Cove."
  exit 0
fi

echo "$MODEL_ID is not installed. Downloading it with Ollama..."
exec ollama pull "$MODEL_ID"

#!/bin/sh
set -eu

ROOT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIRECTORY"

export UV_CACHE_DIR="$ROOT_DIRECTORY/.cache/uv"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required. Install it from https://docs.astral.sh/uv/ and retry." >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required for local voice transcription." >&2
  exit 1
fi

if [ ! -x .venv/bin/python ]; then
  uv venv --python 3.12 .venv
fi

uv pip install --python .venv/bin/python openai-whisper
.venv/bin/python - <<'PY'
import whisper

whisper.load_model("base.en", device="cpu", download_root=".cache/whisper")
print("Cove local voice is ready (Whisper base.en).")
PY

#!/usr/bin/env python3
"""Transcribe one audio file with the project-local Whisper model."""

import json
import sys
from pathlib import Path

import whisper


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: transcribe-local.py AUDIO_FILE MODEL_DIRECTORY")

    audio_path = Path(sys.argv[1]).resolve()
    model_directory = Path(sys.argv[2]).resolve()
    if not audio_path.is_file():
        raise SystemExit("audio file does not exist")

    model = whisper.load_model("base.en", device="cpu", download_root=str(model_directory))
    result = model.transcribe(
        str(audio_path),
        language="en",
        fp16=False,
        verbose=False,
        condition_on_previous_text=False,
    )
    print(json.dumps({"text": str(result.get("text", "")).strip()}))


if __name__ == "__main__":
    main()

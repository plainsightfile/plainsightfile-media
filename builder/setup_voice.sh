#!/usr/bin/env bash
# setup_voice.sh: install the narration voice (Kokoro, open source) for build_video.mjs --voice.
# Safe to run every time: skips what is already there. About 350 MB of model files, fetched from
# the kokoro-onnx GitHub release (GitHub is reachable from the scheduled cloud runs) and checked by SHA-256.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="${VOICE_MODELS:-$HERE/voice-models}"
mkdir -p "$DIR"

python3 -c "import kokoro_onnx, soundfile, numpy" 2>/dev/null || \
  pip install --quiet --break-system-packages "kokoro-onnx==0.6.1" "soundfile==0.14.0"

BASE="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
fetch() { # name sha256
  local f="$DIR/$1"
  if [ -f "$f" ] && echo "$2  $f" | sha256sum -c --status; then return 0; fi
  curl -fsSL --retry 3 -o "$f.part" "$BASE/$1"
  echo "$2  $f.part" | sha256sum -c --status || { echo "checksum mismatch for $1" >&2; rm -f "$f.part"; exit 1; }
  mv "$f.part" "$f"
}
fetch kokoro-v1.0.onnx 7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5
fetch voices-v1.0.bin  bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d
echo "voice ready in $DIR"

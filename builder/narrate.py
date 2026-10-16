#!/usr/bin/env python3
"""narrate.py: speak each slide's narration line with Kokoro (open-source TTS, Apache 2.0 model).

Called by build_video.mjs when --voice is given. Run it with `python3 -I` so nothing in the
working folder can shadow a module.

    python3 -I narrate.py --models DIR --voice bf_emma --speed 0.95 --lines lines.json --out DIR

  lines.json  a JSON list of strings, one per slide; an empty string means a silent slide
  DIR         holds kokoro-v1.0.onnx and voices-v1.0.bin (setup_voice.sh downloads them)

Prints one JSON object: {"sample_rate": 24000, "voice": "...", "clips": [{"file": ".../voice-01.wav", "secs": 2.31} | null, ...]}
"""
import argparse
import json
import os
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ap = argparse.ArgumentParser()
ap.add_argument("--models", required=True)
ap.add_argument("--voice", default="bf_emma")
ap.add_argument("--speed", type=float, default=0.95)
ap.add_argument("--lines", required=True)
ap.add_argument("--out", required=True)
a = ap.parse_args()

k = Kokoro(os.path.join(a.models, "kokoro-v1.0.onnx"), os.path.join(a.models, "voices-v1.0.bin"))
if a.voice not in k.get_voices():
    sys.exit("unknown voice %r; available: %s" % (a.voice, ", ".join(sorted(k.get_voices()))))
# Kokoro voice names start with a for American English and b for British English.
lang = "en-gb" if a.voice.startswith("b") else "en-us"

with open(a.lines, encoding="utf-8") as f:
    lines = json.load(f)

clips, sr_out = [], 24000
for i, text in enumerate(lines):
    text = (text or "").strip()
    if not text:
        clips.append(None)
        continue
    samples, sr = k.create(text, voice=a.voice, speed=a.speed, lang=lang)
    sr_out = sr
    # trim leading and trailing near-silence so slide timing follows the words, not the model's padding
    s = np.asarray(samples, dtype=np.float32)
    loud = np.where(np.abs(s) > 0.01)[0]
    if loud.size:
        pad = int(0.04 * sr)
        s = s[max(0, loud[0] - pad):min(len(s), loud[-1] + pad)]
    path = os.path.join(a.out, "voice-%02d.wav" % (i + 1))
    sf.write(path, s, sr)
    clips.append({"file": path, "secs": round(len(s) / sr, 3)})

print(json.dumps({"sample_rate": sr_out, "voice": a.voice, "lang": lang, "speed": a.speed, "clips": clips}))

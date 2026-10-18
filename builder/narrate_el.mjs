#!/usr/bin/env node
/*
  narrate_el.mjs: speak each slide's narration line with an ElevenLabs voice. Same job and same output as narrate.py
  (Kokoro), so build_video.mjs can use either.

    node narrate_el.mjs --voice-id <id> --lines lines.json --out DIR [--model eleven_v4] [--whole] [--urls urls.json]

  lines.json  a JSON list of strings, one per slide; an empty string means a silent slide
  --urls      a JSON list of audio URLs, one per slide (null for silent), for takes the ElevenLabs connector already
              made. Without it the takes are generated with the ElevenLabs API, which needs the repo secret
              ELEVENLABS_API_KEY on plainsightfile/plainsightfile-media.
  --whole     read every line in ONE continuous take (so the delivery flows from slide to slide like one person
              talking), then cut it back into one clip per slide with ElevenLabs' character timestamps.

  The build machine can reach GitHub but not ElevenLabs, so the network part runs in the "narration" GitHub Action
  (.github/workflows/narration.yml): this script sends it a repository_dispatch with a one-time key, waits for the
  encrypted result on branch narration-out, decrypts it, and trims each clip. Needs gh (authenticated), git, openssl,
  ffmpeg/ffprobe. With ELEVENLABS_API_KEY in the environment it calls ElevenLabs directly instead (no courier).

  Prints one JSON object: {"engine": "ElevenLabs", "voice": id, "model": ..., "clips": [{"file", "secs"} | null, ...]}
  Exits non-zero with a message on any failure (build_video.mjs then falls back to Kokoro).
*/
import {spawnSync} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPO = process.env.NARRATION_REPO || "plainsightfile/plainsightfile-media";
const argv = process.argv.slice(2), opt = {model: "eleven_v4", timeout: "300"};
for (let i = 0; i < argv.length; i++) { const k = argv[i].replace(/^--/, ""); if (k === "whole") opt.whole = true; else opt[k] = argv[++i]; }
const die = m => { console.error("narrate_el: " + m); process.exit(1); };
if (!opt["voice-id"] || !/^[A-Za-z0-9]{10,40}$/.test(opt["voice-id"])) die("--voice-id is required (an ElevenLabs voice id)");
if (!opt.lines || !opt.out) die("--lines and --out are required");

const run = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, {encoding: o.binary ? "buffer" : "utf8", maxBuffer: 1 << 28, ...o});
  if (r.status !== 0 && !o.ok) die(`${cmd} ${args.slice(0, 3).join(" ")} failed: ${String(r.stderr || "").slice(-400)}`);
  return r;
};
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/* Pronunciations (automation/voice.json "pronunciations"): respell tricky names in the TEXT SENT TO THE VOICE ONLY, so
   Rhea says her own name the same way every time (Alex picked "Reeah Littee", October 18, 2026). Slides and captions keep the real spelling. */
const pron = (() => { try { return JSON.parse(fs.readFileSync(new URL("../automation/voice.json", import.meta.url), "utf8")).pronunciations || {}; } catch { return {}; } })();
const respell = t => Object.entries(pron).reduce((x, [from, to]) => x.replace(new RegExp("\\b" + from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"), to), String(t ?? ""));
const lines = JSON.parse(fs.readFileSync(opt.lines, "utf8")).map(respell);
const out = path.resolve(opt.out); fs.mkdirSync(out, {recursive: true});
const work = fs.mkdtempSync(path.join(out, ".el-"));
const id = "n" + Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex");
const key = crypto.randomBytes(32).toString("hex");
const keyFile = path.join(work, "key"); fs.writeFileSync(keyFile, key, {mode: 0o600});

let payload;
if (opt.urls) {
  const urls = JSON.parse(fs.readFileSync(opt.urls, "utf8"));
  if (urls.length !== lines.length) die(`--urls has ${urls.length} entries for ${lines.length} lines`);
  payload = {id, key, mode: "urls", items: urls};
} else {
  payload = {id, key, mode: opt.whole ? "whole" : "tts", items: {voice_id: opt["voice-id"], model_id: opt.model, lines,
    ...(opt.settings ? {voice_settings: JSON.parse(opt.settings)} : {}), ...(opt.seed ? {seed: Number(opt.seed)} : {})}};
}
const raw = path.join(work, "raw"); fs.mkdirSync(raw);
let manifest;
if (process.env.ELEVENLABS_API_KEY && !opt.urls) {
  /* Direct mode: where ElevenLabs is reachable (the one-click "make-video" GitHub Action, or Alex's own computer),
     call the API here instead of going through the courier. Same request, same files, same splitting below. */
  const it = payload.items, xi = process.env.ELEVENLABS_API_KEY;
  const post = async (url, body) => { const r = await fetch(url, {method: "POST", headers: {"xi-api-key": xi, "Content-Type": "application/json"}, body: JSON.stringify(body)});
    if (!r.ok) die(`ElevenLabs answered ${r.status}: ${(await r.text()).slice(0, 300)}`); return r; };
  const base = {model_id: it.model_id, ...(it.voice_settings ? {voice_settings: it.voice_settings} : {}), ...(it.seed != null ? {seed: it.seed} : {})};
  manifest = {id, clips: lines.map(() => null)};
  if (opt.whole) {
    const text = lines.map(l => String(l || "").trim()).filter(Boolean).join("\n");
    const res = await (await post(`https://api.elevenlabs.io/v1/text-to-speech/${it.voice_id}/with-timestamps?output_format=mp3_44100_128`, {text, ...base})).json();
    fs.writeFileSync(path.join(raw, "whole.mp3"), Buffer.from(res.audio_base64, "base64"));
    fs.writeFileSync(path.join(raw, "alignment.json"), JSON.stringify({text, alignment: res.alignment, normalized_alignment: res.normalized_alignment}));
    manifest.whole = "whole.mp3"; manifest.alignment = "alignment.json";
  } else {
    for (let i = 0; i < lines.length; i++) { const t = String(lines[i] || "").trim(); if (!t) continue;
      const r = await post(`https://api.elevenlabs.io/v1/text-to-speech/${it.voice_id}?output_format=mp3_44100_128`, {text: t, ...base});
      const f = `voice-${String(i + 1).padStart(2, "0")}.mp3`; fs.writeFileSync(path.join(raw, f), Buffer.from(await r.arrayBuffer())); manifest.clips[i] = f; }
  }
} else {
const pf = path.join(work, "payload.json");
fs.writeFileSync(pf, JSON.stringify({event_type: "narrate", client_payload: payload}), {mode: 0o600});

/* where the result branch is now, so we can tell when it moves */
const head = () => (run("git", ["ls-remote", `https://github.com/${REPO}`, "refs/heads/narration-out"], {ok: true}).stdout || "").split(/\s/)[0] || "";
const before = head();
run("gh", ["api", `repos/${REPO}/dispatches`, "-X", "POST", "--input", pf]);
fs.rmSync(pf, {force: true});

/* wait for our own result (another run may move the branch too, so check the file name) */
const deadline = Date.now() + Number(opt.timeout) * 1000;
const clone = path.join(work, "res");
let blob = null, seen = before;
while (Date.now() < deadline && !blob) {
  sleep(5000);
  const h = head(); if (!h || h === seen) continue; seen = h;
  fs.rmSync(clone, {recursive: true, force: true});
  if (run("git", ["clone", "-q", "--depth", "1", "-b", "narration-out", `https://github.com/${REPO}`, clone], {ok: true}).status !== 0) continue;
  if (fs.existsSync(path.join(clone, id + ".FAILED"))) die("the narration Action failed: " + fs.readFileSync(path.join(clone, id + ".FAILED"), "utf8").trim() +
    ` (https://github.com/${REPO}/actions)`);
  if (fs.existsSync(path.join(clone, id + ".bin"))) blob = path.join(clone, id + ".bin");
}
if (!blob) die(`no result after ${opt.timeout} s (https://github.com/${REPO}/actions)`);

/* decrypt and unpack */
const tarball = run("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-pass", "file:" + keyFile, "-in", blob], {binary: true}).stdout;
run("tar", ["-xzf", "-", "-C", raw], {input: tarball});
manifest = JSON.parse(fs.readFileSync(path.join(raw, "manifest.json"), "utf8"));
}
if (manifest.id !== id || manifest.clips.length !== lines.length) die("result does not match the request");

/* one continuous take: cut it at the middle of the pause between each pair of lines */
if (manifest.whole) {
  const al = JSON.parse(fs.readFileSync(path.join(raw, "alignment.json"), "utf8"));
  const a = al.alignment;
  if (!a || a.characters.join("") !== al.text) die("timestamps do not line up with the text");
  const st = a.character_start_times_seconds, en = a.character_end_times_seconds;
  const spans = []; let pos = 0;
  lines.forEach((l, i) => { const t = String(l || "").trim(); if (!t) return;
    const lo = pos, hi = pos + t.length - 1; pos += t.length + 1; spans.push({i, start: st[lo], end: en[hi]}); });
  const whole = path.join(raw, "whole.mp3");
  const dur = Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", whole]).stdout.trim());
  /* ElevenLabs' character timestamps can drift from the audio (October 16, 2026: cuts landed mid-word and the last
     line came out 1.3 s long). So the timestamps only PREDICT each cut; the cut itself goes in the middle of the real
     pause (silencedetect) nearest that prediction, after scaling the timeline to the audio's true length. */
  const tEnd = en[en.length - 1] || dur, scale = tEnd > 0 ? Math.min(1.25, Math.max(0.8, (dur - 0.05) / tEnd)) : 1;
  const sd = run("ffmpeg", ["-hide_banner", "-i", whole, "-af", "silencedetect=noise=-38dB:d=0.12", "-f", "null", "-"], {ok: true}).stderr || "";
  const sil = []; let s0 = null;
  sd.split("\n").forEach(l => { let m = l.match(/silence_start: ([\d.]+)/); if (m) s0 = +m[1];
    m = l.match(/silence_end: ([\d.]+)/); if (m && s0 !== null) { sil.push({a: s0, b: +m[1], mid: (s0 + +m[1]) / 2}); s0 = null; } });
  const cuts = [0];
  for (let k = 1; k < spans.length; k++) {
    const pred = ((spans[k - 1].end + spans[k].start) / 2) * scale, lo = cuts[k - 1] + 0.3;
    const cand = sil.filter(x => x.mid > lo && x.b < dur - 0.1).sort((x, y) => Math.abs(x.mid - pred) - Math.abs(y.mid - pred))[0];
    cuts.push(cand && Math.abs(cand.mid - pred) < 2.5 ? cand.mid : Math.max(lo, pred));
  }
  cuts.push(dur);
  if (opt.debug) fs.writeFileSync(opt.debug, JSON.stringify({dur, tEnd, scale, silences: sil, spans, cuts}, null, 1));
  if (opt.debug) fs.copyFileSync(whole, opt.debug + ".mp3");
  spans.forEach((sp, k) => {
    const from = cuts[k], to = cuts[k + 1];
    const f = `voice-${String(sp.i + 1).padStart(2, "0")}.mp3`;
    run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", whole, "-ss", from.toFixed(3), "-to", to.toFixed(3), "-c:a", "pcm_s16le", path.join(raw, f.replace(".mp3", ".cut.wav"))]);
    fs.renameSync(path.join(raw, f.replace(".mp3", ".cut.wav")), path.join(raw, f));
    manifest.clips[sp.i] = f;
  });
}

/* mp3 -> wav, with the leading and trailing near-silence trimmed (40 ms kept) like narrate.py does */
const TRIM = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06";
const FADE = "afade=t=in:d=0.015,areverse,afade=t=in:d=0.03,areverse"; /* no clicks at the cut points */
const clips = manifest.clips.map((c, i) => {
  if (!c || !String(lines[i] || "").trim()) return null;
  if (!/^voice-\d{2}\.mp3$/.test(c)) die("unexpected file name in result");
  const dst = path.join(out, `voice-${String(i + 1).padStart(2, "0")}.wav`);
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", path.join(raw, c), "-af", `${TRIM},areverse,${TRIM},areverse,${FADE}`, "-ac", "1", "-ar", "44100", dst]);
  const secs = +Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", dst]).stdout.trim()).toFixed(3);
  return {file: dst, secs};
});
fs.rmSync(work, {recursive: true, force: true});
console.log(JSON.stringify({engine: "ElevenLabs", voice: opt["voice-id"], model: opt.urls ? "connector takes" : opt.model,
  source: opt.urls ? "connector" : opt.whole ? "api, one continuous take" : "api", clips}));

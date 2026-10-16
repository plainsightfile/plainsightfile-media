#!/usr/bin/env node
/*
  narrate_el.mjs: speak each slide's narration line with an ElevenLabs voice. Same job and same output as narrate.py
  (Kokoro), so build_video.mjs can use either.

    node narrate_el.mjs --voice-id <id> --lines lines.json --out DIR [--model eleven_v4] [--urls urls.json]

  lines.json  a JSON list of strings, one per slide; an empty string means a silent slide
  --urls      a JSON list of audio URLs, one per slide (null for silent), for takes the ElevenLabs connector already
              made. Without it the takes are generated with the ElevenLabs API, which needs the repo secret
              ELEVENLABS_API_KEY on plainsightfile/plainsightfile-media.

  The build machine can reach GitHub but not ElevenLabs, so the network part runs in the "narration" GitHub Action
  (.github/workflows/narration.yml): this script sends it a repository_dispatch with a one-time key, waits for the
  encrypted result on branch narration-out, decrypts it, and trims each clip. Needs gh (authenticated), git, openssl,
  ffmpeg/ffprobe.

  Prints one JSON object: {"engine": "ElevenLabs", "voice": id, "model": ..., "clips": [{"file", "secs"} | null, ...]}
  Exits non-zero with a message on any failure (build_video.mjs then falls back to Kokoro).
*/
import {spawnSync} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPO = process.env.NARRATION_REPO || "plainsightfile/plainsightfile-media";
const argv = process.argv.slice(2), opt = {model: "eleven_v4", timeout: "300"};
for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, "")] = argv[i + 1];
const die = m => { console.error("narrate_el: " + m); process.exit(1); };
if (!opt["voice-id"] || !/^[A-Za-z0-9]{10,40}$/.test(opt["voice-id"])) die("--voice-id is required (an ElevenLabs voice id)");
if (!opt.lines || !opt.out) die("--lines and --out are required");

const run = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, {encoding: o.binary ? "buffer" : "utf8", maxBuffer: 1 << 28, ...o});
  if (r.status !== 0 && !o.ok) die(`${cmd} ${args.slice(0, 3).join(" ")} failed: ${String(r.stderr || "").slice(-400)}`);
  return r;
};
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const lines = JSON.parse(fs.readFileSync(opt.lines, "utf8"));
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
  payload = {id, key, mode: "tts", items: {voice_id: opt["voice-id"], model_id: opt.model, lines}};
}
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
const raw = path.join(work, "raw"); fs.mkdirSync(raw);
const tarball = run("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-pass", "file:" + keyFile, "-in", blob], {binary: true}).stdout;
run("tar", ["-xzf", "-", "-C", raw], {input: tarball});
const manifest = JSON.parse(fs.readFileSync(path.join(raw, "manifest.json"), "utf8"));
if (manifest.id !== id || manifest.clips.length !== lines.length) die("result does not match the request");

/* mp3 -> wav, with the leading and trailing near-silence trimmed (40 ms kept) like narrate.py does */
const TRIM = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04";
const clips = manifest.clips.map((c, i) => {
  if (!c || !String(lines[i] || "").trim()) return null;
  if (!/^voice-\d{2}\.mp3$/.test(c)) die("unexpected file name in result");
  const dst = path.join(out, `voice-${String(i + 1).padStart(2, "0")}.wav`);
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", path.join(raw, c), "-af", `${TRIM},areverse,${TRIM},areverse`, "-ac", "1", "-ar", "44100", dst]);
  const secs = +Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", dst]).stdout.trim()).toFixed(3);
  return {file: dst, secs};
});
fs.rmSync(work, {recursive: true, force: true});
console.log(JSON.stringify({engine: "ElevenLabs", voice: opt["voice-id"], model: opt.urls ? "connector takes" : opt.model,
  source: opt.urls ? "connector" : "api", clips}));

#!/usr/bin/env node
/*
  build_video.mjs: turn an approved Plain Sight File into a TikTok-ready MP4, using HQ's own renderer.

  Usage:
    node build_video.mjs <script.txt | file.json> [options]

  Input:
    script.txt   a slide script exactly as typed in HQ's Studio (DEVICE:, LOCATION:, slides split by ---)
    file.json    a record from HQ's "files" collection: {script, fileno, look, locPlace, locCountry, caption?, story?, type?}
                 (a wrapper like {"id":..., "data":{...}} is unwrapped automatically)

  Options:
    --hq <path>         HQ HTML file to render with (default: ./hq.html next to this script)
    --out <dir>         output folder (default: ./out/<type>-<fileno>)
    --fileno <NNN>      File No. for a .txt input (default 000). JSON inputs use their own.
    --look <auto|dark|light|classic>   look for a .txt input (default auto)
    --music <file>      licensed track: looped or trimmed to length, faded out, loudness-normalised
    --lufs <n>          integrated loudness target for --music (default -16)
    --tp <n>            true-peak ceiling in dBTP (default -1.5)
    --xfade <ms>        crossfade between slides instead of hard cuts (default 0 = hard cut)
    --kbps <n>          constant video bitrate (default 6000, inside Metricool's recommended 5,000 to 25,000 kbps).
                        --kbps 0 switches to CRF quality mode: about 2.6 MB instead of 32 MB, same look.
    --crf <n>           x264 quality when --kbps 0 (default 16)
    --frames-only       render the slide frames, caption and pinned comment only: no audio, no encode, no video.mp4
                        (about 10 s instead of about 50 s). For drafting and checking; the publisher builds the real video.
    --date <YYYY-MM-DD> pretend today is this day inside HQ, so the hook's date stamp is fixed (the posting day) instead of
                        the day the build happens to run. Defaults to the real date in America/Vancouver.

  Outputs (in --out):
    video.mp4  cover.jpg  caption.txt  pinned-comment.txt  timings.json  frames/NN-type.png  report.json
    (with --frames-only: no video.mp4 or cover.jpg, and report.json has frames_only: true)

  Needs: Playwright (Node) with Chromium, ffmpeg/ffprobe, and the @fontsource packages in ./node_modules
  (npm ci in this folder). Everything HQ fetches from the internet (Google Fonts, cdnjs JSZip) is served
  from local copies, so a render never depends on network access.
*/
import {createRequire} from "node:module";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const t0 = Date.now();
const lap = {};
const mark = (k, since) => { lap[k] = +((Date.now() - since) / 1000).toFixed(2); return Date.now(); };

/* ---------------- arguments ---------------- */
const argv = process.argv.slice(2);
const opt = {hq: path.join(HERE, "hq.html"), lufs: -16, tp: -1.5, xfade: 0, crf: 16, look: "auto", fileno: "000"};
let input = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    if (k === "keep-frames") continue;
    if (k === "frames-only") { opt[k] = true; continue; }
    opt[k] = argv[++i];
  } else input = a;
}
if (!input) { console.error("usage: node build_video.mjs <script.txt|file.json> [--music track.mp3] [--out dir]"); process.exit(2); }
opt.lufs = Number(opt.lufs); opt.tp = Number(opt.tp); opt.xfade = Number(opt.xfade) / 1000; opt.crf = Number(opt.crf); opt.kbps = opt.kbps === undefined ? 6000 : Number(opt.kbps);
if (opt.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(opt.date))) { console.error("--date must look like 2026-10-14"); process.exit(2); }

/* ---------------- read the File ---------------- */
const raw = fs.readFileSync(input, "utf8");
let file;
if (/\.json$/i.test(input) || /^\s*\{/.test(raw)) {
  let j = JSON.parse(raw);
  if (j && j.data && typeof j.data === "object" && !j.script) j = j.data;
  file = {script: j.script || "", fileno: j.fileno || opt.fileno, look: j.look || opt.look, locPlace: j.locPlace ?? null,
          locCountry: j.locCountry ?? null, caption: j.caption || "", story: j.story || "", type: j.type === "memo" ? "memo" : "file"};
} else {
  file = {script: raw, fileno: opt.fileno, look: opt.look, locPlace: null, locCountry: null, caption: "", story: "", type: "file"};
}
if (!file.script.trim()) { console.error("The File has no script."); process.exit(2); }
const out = path.resolve(opt.out || path.join(HERE, "out", `${file.type}-${String(file.fileno).replace(/[^\w-]/g, "")}`));
const framesDir = path.join(out, "frames");
fs.rmSync(framesDir, {recursive: true, force: true});
fs.mkdirSync(framesDir, {recursive: true});

/* ---------------- local copies of HQ's web dependencies ---------------- */
function fontCss() {
  /* Same families and weights HQ requests from Google Fonts, from the @fontsource npm packages (SIL OFL 1.1). */
  const want = {"big-shoulders-display": ["700", "800", "900"], "courier-prime": ["400", "700", "400-italic", "700-italic"],
    "ibm-plex-sans": ["400", "500", "600"], "space-grotesk": ["500", "700"], "jetbrains-mono": ["400", "700"]};
  const files = {}; let css = "";
  for (const [pkg, ws] of Object.entries(want)) {
    const dir = path.join(HERE, "node_modules", "@fontsource", pkg);
    if (!fs.existsSync(dir)) throw new Error(`Missing font package @fontsource/${pkg}. Run: npm ci (in ${HERE})`);
    for (const w of ws) {
      const src = fs.readFileSync(path.join(dir, `${w}.css`), "utf8");
      for (const b of src.match(/\/\*[^*]*\*\/\s*@font-face\s*\{[^}]*\}/g) || []) {
        if (!/-(latin|latin-ext)-\d/.test(b)) continue;
        css += b.replace(/url\(\.\/files\/([^)]+?\.woff2)\)/g, (m, f) => { files[f] = path.join(dir, "files", f); return `url(https://fonts.gstatic.com/local/${f})`; })
                .replace(/,\s*url\(\.\/files\/[^)]+\.woff\)\s*format\('woff'\)/g, "") + "\n";
      }
    }
  }
  return {css, files};
}
const fonts = fontCss();
const jszipPath = require.resolve("jszip/dist/jszip.min.js", {paths: [HERE, "/opt/npm-tools/node_modules"]});

/* ---------------- headless render with HQ ---------------- */
function loadPlaywright() {
  for (const p of [process.env.PLAYWRIGHT_PATH, "playwright", "/opt/npm-tools/node_modules/playwright"].filter(Boolean)) {
    try { return require(p); } catch (e) {}
  }
  throw new Error("Playwright not found. npm i playwright, or set PLAYWRIGHT_PATH.");
}
const {chromium} = loadPlaywright();
const exe = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let ts = Date.now();
const browser = await chromium.launch(fs.existsSync(exe) ? {executablePath: exe} : {});
/* America/Vancouver so the hook's date stamp is Alex's date, not the cloud's UTC date. */
const ctx = await browser.newContext({viewport: {width: 1400, height: 1000}, timezoneId: "America/Vancouver", locale: "en-CA"});
const blocked = [];
await ctx.route("**/*", route => {
  const u = route.request().url();
  if (u.startsWith("file:")) return route.continue();
  if (u.startsWith("https://fonts.googleapis.com/css2")) return route.fulfill({status: 200, contentType: "text/css", body: fonts.css});
  const m = u.match(/^https:\/\/fonts\.gstatic\.com\/local\/([\w.-]+\.woff2)$/);
  if (m && fonts.files[m[1]]) return route.fulfill({status: 200, contentType: "font/woff2", body: fs.readFileSync(fonts.files[m[1]])});
  if (/cdnjs\.cloudflare\.com\/ajax\/libs\/jszip\//.test(u)) return route.fulfill({status: 200, contentType: "application/javascript", body: fs.readFileSync(jszipPath)});
  blocked.push(u); return route.abort();
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
/* Fix HQ's clock (Date.now and new Date(); timers keep running) so the hook's date stamp is the day we say, not the day we build.
   20:00 UTC is midday in Vancouver in both PST and PDT, so the Vancouver calendar day is always the one asked for. */
if (opt.date) await page.clock.setFixedTime(new Date(opt.date + "T20:00:00Z"));
const prefs = {script: file.script, fileno: file.fileno, look: file.look, view: "tt", tab: "studio", ttSize2: "full", showGuide: "0",
  caption: file.caption, story: file.story, postType: file.type, tags: "#plainsightfile"};
if (file.locPlace !== null) prefs.locPlace = file.locPlace;
if (file.locCountry !== null) prefs.locCountry = file.locCountry;
await page.addInitScript(([prefs]) => {
  localStorage.clear();
  for (const [k, v] of Object.entries(prefs)) localStorage.setItem("ps:" + k, v);
  /* HQ's Copy buttons are the only public route to its caption and pinned-comment output: capture what they copy. */
  window.__copied = [];
  try { Object.defineProperty(navigator, "clipboard", {value: {writeText: async t => { window.__copied.push(t); }}, configurable: true}); } catch (e) {}
}, [prefs]);
await page.goto("file://" + path.resolve(opt.hq));

/* A .txt input carries LOCATION: in the script. HQ reads it on the script box's input event (syncLocation). */
await page.waitForSelector("#slides img", {timeout: 30000});
if (file.locPlace === null && file.locCountry === null) {
  await page.evaluate(() => document.getElementById("script").dispatchEvent(new Event("input", {bubbles: true})));
}
/* Wait until the slide strip stops changing and every web font is in. */
const settled = await page.waitForFunction(() => {
  const imgs = [...document.querySelectorAll("#slides img")];
  if (!imgs.length || document.fonts.status !== "loaded") return false;
  const sig = imgs.map(i => i.src.length).join(",");
  const w = window.__settle || (window.__settle = {sig: "", n: 0});
  if (sig === w.sig) w.n++; else { w.sig = sig; w.n = 0; }
  return w.n >= 4;
}, null, {polling: 250, timeout: 30000}).catch(() => null);
if (!settled) throw new Error("HQ did not finish rendering within 30 s.");

const info = await page.evaluate(async () => {
  const fam = ['900 100px "Big Shoulders Display"', '700 100px "Space Grotesk"', '500 100px "Space Grotesk"', '400 30px "JetBrains Mono"',
    '700 30px "JetBrains Mono"', '400 30px "Courier Prime"', '700 30px "Courier Prime"'];
  const fontsOk = Object.fromEntries(fam.map(f => [f, document.fonts.check(f)]));
  const imgs = [...document.querySelectorAll("#slides img")];
  const dims = await Promise.all(imgs.map(i => i.decode().then(() => [i.naturalWidth, i.naturalHeight])));
  const labels = [...document.querySelectorAll("#slides figcaption span")].map(s => s.textContent);
  document.getElementById("capCopy").click();
  document.getElementById("pinCopy").click();
  await new Promise(r => setTimeout(r, 300));
  return {fontsOk, dims, labels, srcs: imgs.map(i => i.src), count: document.getElementById("count").textContent,
    capBox: document.getElementById("caption").value, pin: document.getElementById("pinText").value, copied: window.__copied,
    loc: [document.getElementById("locPlace").value, document.getElementById("locCountry").value]};
});
await browser.close();
ts = mark("render_s", ts);

if (errors.length) throw new Error("HQ page errors: " + errors.join(" | "));
const badFont = Object.entries(info.fontsOk).filter(([, ok]) => !ok).map(([f]) => f);
if (badFont.length) throw new Error("Fonts did not load (frames would use fallbacks): " + badFont.join(", "));
info.dims.forEach(([w, h], i) => { if (w !== 1080 || h !== 1920) throw new Error(`Frame ${i + 1} is ${w}x${h}, expected 1080x1920`); });

/* ---------------- frames + timings ---------------- */
const slides = info.labels.map((lab, i) => {
  const m = lab.match(/^(\d+)\s*·\s*(.+?)\s*·\s*([\d.]+)\s*s$/);
  if (!m) throw new Error("Could not read slide timing from label: " + lab);
  const type = m[2].toLowerCase().replace(/\s+/g, "-");
  const name = `${String(i + 1).padStart(2, "0")}-${type}.png`;
  fs.writeFileSync(path.join(framesDir, name), Buffer.from(info.srcs[i].split(",")[1], "base64"));
  return {n: i + 1, type: m[2], secs: Number(m[3]), frame: "frames/" + name};
});
let at = 0;
slides.forEach(s => { s.start = +at.toFixed(3); at += s.secs; s.end = +at.toFixed(3); });
const total = +at.toFixed(3);

/* ---------------- caption + pinned comment (HQ's own output) ---------------- */
const caption = info.copied[0] ?? "", pinned = info.copied[1] ?? info.pin;
fs.writeFileSync(path.join(out, "caption.txt"), caption + "\n");
fs.writeFileSync(path.join(out, "pinned-comment.txt"), pinned + "\n");
const timingsJson = () => JSON.stringify({total_secs: total, slides: slides.map(({n, type, secs, start, end, frame}) => ({n, type, secs, start, end, frame}))}, null, 2) + "\n";

/* ---------------- frames only: stop here (no audio, no encode) ---------------- */
if (opt["frames-only"]) {
  const report = {
    input: path.resolve(input), hq: path.resolve(opt.hq), fileno: file.fileno, look: file.look, location: info.loc,
    frames_only: true, render_date: opt.date || null, hq_count_line: info.count, slides, total_secs: total,
    caption_chars: caption.length, pinned_chars: pinned.length, blocked_requests: blocked,
    timings_s: {...lap, total_s: +((Date.now() - t0) / 1000).toFixed(2)}
  };
  fs.writeFileSync(path.join(out, "timings.json"), timingsJson());
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  console.log("\nWrote frames only to", out);
  process.exit(0);
}

/* ---------------- ffmpeg helpers ---------------- */
function run(cmd, args) {
  const r = spawnSync(cmd, args, {encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  if (r.status !== 0) throw new Error(`${cmd} failed:\n${(r.stderr || "").slice(-3000)}`);
  return r;
}
const FF = process.env.FFMPEG || "/usr/bin/ffmpeg", FP = process.env.FFPROBE || "/usr/bin/ffprobe";

/* ---------------- audio bed ---------------- */
const audioPath = path.join(out, "audio.m4a");
const fadeOut = Math.min(1.5, total / 4), fadeIn = 0.05;
let audio = {};
/* Two-pass EBU R128 normalisation (pass 1 measures, pass 2 applies one linear gain), then short fade in and a fade out.
   Linear mode keeps the track's own dynamics; a fixed gain also means the loop point never pumps. */
function normalise(srcArgs, I, TP, LRA) {
  const ln = `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}`;
  const p1 = run(FF, ["-hide_banner", "-nostats", ...srcArgs, "-t", String(total), "-af", ln + ":print_format=json", "-f", "null", "-"]);
  const meas = JSON.parse(p1.stderr.slice(p1.stderr.lastIndexOf("{"), p1.stderr.lastIndexOf("}") + 1));
  /* loudnorm only stays linear if the target LRA is at least the track's own LRA: widen it so music is never compressed */
  const lra2 = Math.max(LRA, Math.min(50, Math.ceil(+meas.input_lra + 1)));
  const af = `loudnorm=I=${I}:TP=${TP}:LRA=${lra2}:measured_I=${meas.input_i}:measured_TP=${meas.input_tp}:measured_LRA=${meas.input_lra}:measured_thresh=${meas.input_thresh}:offset=${meas.target_offset}:linear=true:print_format=json,` +
             `aresample=48000,afade=t=in:d=${fadeIn},afade=t=out:st=${(total - fadeOut).toFixed(3)}:d=${fadeOut}`;
  const p2 = run(FF, ["-y", "-hide_banner", "-nostats", ...srcArgs, "-t", String(total), "-af", af, "-ac", "2", "-c:a", "aac", "-b:a", "128k", audioPath]);
  const m2 = JSON.parse(p2.stderr.slice(p2.stderr.lastIndexOf("{"), p2.stderr.lastIndexOf("}") + 1));
  return {input_lufs: +meas.input_i, input_true_peak: +meas.input_tp, normalization: m2.normalization_type};
}
if (opt.music) {
  /* licensed track: -stream_loop -1 repeats a short track, -t trims a long one to the video length */
  audio = {source: path.resolve(opt.music), target_lufs: opt.lufs, target_tp: opt.tp,
    ...normalise(["-stream_loop", "-1", "-i", opt.music], opt.lufs, opt.tp, 11)};
} else {
  /* placeholder drone: two low sines a fifth apart plus low-passed brown noise with a slow tremolo, at -20 LUFS */
  const raw = path.join(out, "drone.wav");
  const gen = `sine=f=55:r=48000:d=${total}[a];sine=f=82.41:r=48000:d=${total}[b];anoisesrc=c=brown:r=48000:a=0.5:d=${total},lowpass=f=400[c];` +
    `[a]volume=0.5[a2];[b]volume=0.25[b2];[c]volume=0.35[c2];[a2][b2][c2]amix=inputs=3:normalize=0,tremolo=f=0.2:d=0.4,pan=stereo|c0=c0|c1=c0`;
  run(FF, ["-y", "-hide_banner", "-filter_complex", gen, "-t", String(total), raw]);
  audio = {source: "placeholder (lavfi sine + brown noise)", target_lufs: -20, target_tp: -3, ...normalise(["-i", raw], -20, -3, 7)};
  fs.rmSync(raw, {force: true});
}
ts = mark("audio_s", ts);

/* ---------------- video ---------------- */
const X = opt.xfade > 0 ? opt.xfade : 0;
const vArgs = ["-y", "-hide_banner"];
slides.forEach((s, i) => vArgs.push("-loop", "1", "-framerate", "30", "-t", String(s.secs + (X && i < slides.length - 1 ? X : 0)), "-i", path.join(out, s.frame)));
vArgs.push("-i", audioPath);
/* RGB PNG to BT.709 limited-range 4:2:0 with explicit tags, so the accent colours are not shifted by a BT.601 guess downstream */
const prep = i => `[${i}:v]fps=30,scale=1080:1920:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1[v${i}]`;
let graph = slides.map((s, i) => prep(i)).join(";") + ";";
if (!X) graph += slides.map((s, i) => `[v${i}]`).join("") + `concat=n=${slides.length}:v=1:a=0[vout]`;
else {
  let prev = "v0", acc = 0;
  for (let i = 1; i < slides.length; i++) { acc += slides[i - 1].secs; const o = i === slides.length - 1 ? "vout" : `x${i}`;
    graph += `[${prev}][v${i}]xfade=transition=fade:duration=${X}:offset=${acc.toFixed(3)}[${o}];`; prev = o; }
  graph = graph.replace(/;$/, "");
}
const mp4 = path.join(out, "video.mp4");
vArgs.push("-filter_complex", graph, "-map", "[vout]", "-map", `${slides.length}:a`,
  "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-tune", "stillimage", ...(opt.kbps ? ["-b:v", `${opt.kbps}k`, "-minrate", `${opt.kbps}k`, "-maxrate", `${opt.kbps}k`, "-bufsize", `${opt.kbps * 2}k`, "-x264-params", "nal-hrd=cbr:force-cfr=1"]
             : ["-crf", String(opt.crf)]),
  "-level:v", "4.1", "-g", "60", "-pix_fmt", "yuv420p", "-r", "30", "-fps_mode", "cfr",
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
  "-c:a", "copy", "-t", String(total), "-movflags", "+faststart", "-tag:v", "avc1", mp4);
run(FF, vArgs);
fs.rmSync(audioPath, {force: true});
ts = mark("encode_s", ts);

/* ---------------- cover (hook frame) ---------------- */
run(FF, ["-y", "-hide_banner", "-i", path.join(out, slides[0].frame), "-q:v", "2", "-pix_fmt", "yuvj420p", path.join(out, "cover.jpg")]);

/* ---------------- verify ---------------- */
const probe = JSON.parse(run(FP, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", mp4]).stdout);
const loud = run(FF, ["-hide_banner", "-nostats", "-i", mp4, "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr;
const grab = (re) => { const m = loud.match(re); return m ? Number(m[1]) : null; };
const v = probe.streams.find(s => s.codec_type === "video"), a = probe.streams.find(s => s.codec_type === "audio");
const report = {
  input: path.resolve(input), hq: path.resolve(opt.hq), fileno: file.fileno, look: file.look, location: info.loc,
  render_date: opt.date || null, hq_count_line: info.count, slides, total_secs: total, transition: X ? `crossfade ${X * 1000} ms` : "hard cut", audio,
  video: {codec: v.codec_name, profile: v.profile, level: v.level, pix_fmt: v.pix_fmt, width: v.width, height: v.height, fps: v.r_frame_rate,
    color: [v.color_space, v.color_primaries, v.color_transfer, v.color_range].join("/"), bitrate_kbps: Math.round(v.bit_rate / 1000), frames: +v.nb_frames},
  audio_stream: {codec: a.codec_name, profile: a.profile, sample_rate: +a.sample_rate, channels: a.channels, bitrate_kbps: Math.round(a.bit_rate / 1000),
    measured_lufs: grab(/Integrated loudness:\s*\n\s*I:\s+(-?[\d.]+) LUFS/), measured_true_peak_dbfs: grab(/Peak:\s+(-?[\d.]+) dBFS\s*$/m)},
  container: {format: probe.format.format_name, duration_s: +probe.format.duration, size_bytes: +probe.format.size,
    faststart: (() => { const b = fs.readFileSync(mp4); const moov = b.indexOf("moov"), mdat = b.indexOf("mdat"); return moov > -1 && moov < mdat; })()},
  caption_chars: caption.length, pinned_chars: pinned.length, blocked_requests: blocked, timings_s: {...lap, total_s: +((Date.now() - t0) / 1000).toFixed(2)}
};
fs.writeFileSync(path.join(out, "timings.json"), timingsJson());
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
console.log("\nWrote", out);

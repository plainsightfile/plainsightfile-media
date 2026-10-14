#!/usr/bin/env node
/*
  hq_tool.mjs: run HQ's own text functions headlessly, so the automation drafts, cleans and checks
  posts with exactly the rules HQ uses (one source of truth: hq.html).

  Commands (all print JSON to stdout):
    prompts  --story story.json --type file|memo --fileno NNN [--script script.txt]
             -> {studioText, slidePrompt, captionPrompt?}   captionPrompt needs --script
    clean-script  --in raw.txt
             -> {script, locPlace, locCountry}   em dashes removed, quotes paired, LOCATION: line taken out
    clean-caption --in raw.txt --type file|memo --fileno NNN
             -> {caption, chars, over}   HQ's tiktokCaption + cleanTags + noDash
    shorten-prompt --in caption.txt
             -> {prompt}
    lint  --packet packet.json [--report report.json]
             -> {ok, issues[], warnings[], stats{}}
    hash  --packet packet.json
             -> {hash}   sha256 of the fields that define what posts (same canonical form HQ's Approve uses)

  story.json is a record from HQ's "stories" collection.
  packet.json is a record from HQ's "queue" collection: {type, fileno, script, caption, pinned, locPlace, locCountry, look, ...}
*/
import {createRequire} from "node:module";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const [cmd, ...rest] = process.argv.slice(2);
const opt = {hq: path.join(HERE, "hq.html")};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith("--")) opt[rest[i].slice(2)] = rest[++i];
const readJson = p => { let j = JSON.parse(fs.readFileSync(p, "utf8")); if (j && j.data && typeof j.data === "object" && !j.script && !j.title) j = j.data; return j; };
const out = o => { process.stdout.write(JSON.stringify(o, null, 2) + "\n"); };

import {packetHash} from "./packet_hash.mjs";
if (cmd === "hash") { out({hash: packetHash(readJson(opt.packet))}); process.exit(0); }

function loadPlaywright() {
  for (const p of [process.env.PLAYWRIGHT_PATH, "playwright", "/opt/npm-tools/node_modules/playwright"].filter(Boolean)) {
    try { return require(p); } catch (e) {}
  }
  throw new Error("Playwright not found. npm i playwright, or set PLAYWRIGHT_PATH.");
}
async function withHQ(prefs, fn) {
  const {chromium} = loadPlaywright();
  const exe = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
  const browser = await chromium.launch(fs.existsSync(exe) ? {executablePath: exe} : {});
  try {
    const ctx = await browser.newContext({timezoneId: "America/Vancouver", locale: "en-CA"});
    const jszip = require.resolve("jszip/dist/jszip.min.js", {paths: [HERE, "/opt/npm-tools/node_modules"]});
    await ctx.route("**/*", route => {
      const u = route.request().url();
      if (u.startsWith("file:")) return route.continue();
      if (/cdnjs\.cloudflare\.com\/ajax\/libs\/jszip\//.test(u)) return route.fulfill({status: 200, contentType: "application/javascript", body: fs.readFileSync(jszip)});
      return route.abort();
    });
    const page = await ctx.newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(([prefs]) => { localStorage.clear(); for (const [k, v] of Object.entries(prefs)) localStorage.setItem("ps:" + k, v); }, [prefs]);
    await page.goto("file://" + path.resolve(opt.hq));
    await page.waitForFunction(() => window.PSHQ && window.PSHQ.studioText && window.PSHQ.parseScript, null, {timeout: 20000});
    const r = await fn(page);
    if (errors.length) r.pageErrors = errors;
    return r;
  } finally { await browser.close(); }
}
const base = (type, fileno) => ({postType: type === "memo" ? "memo" : "file", fileno: String(fileno || "000"), tags: "#plainsightfile", tab: "studio", view: "tt", ttSize2: "full", look: "auto"});

if (cmd === "prompts") {
  const story = readJson(opt.story);
  const script = opt.script ? fs.readFileSync(opt.script, "utf8") : "";
  const r = await withHQ(base(opt.type, opt.fileno), page => page.evaluate(([story, script]) => { const H = window.PSHQ;
    const st = H.studioText(Object.assign({id: story.id || ""}, story));
    document.getElementById("story").value = st;
    const res = {studioText: st, slidePrompt: H.draftRules() + st};
    if (script) { document.getElementById("script").value = script; res.captionPrompt = H.captionPrompt(); }
    return res;
  }, [story, script]));
  out(r);
} else if (cmd === "clean-script") {
  const raw = fs.readFileSync(opt.in, "utf8");
  out(await withHQ(base("file"), page => page.evaluate(raw => { const H = window.PSHQ;
    document.getElementById("locPlace").value = ""; document.getElementById("locCountry").value = "";
    /* the writer sometimes wraps the script in a code fence: drop it */
    raw = raw.replace(/^\s*```[a-z]*\s*\n/i, "").replace(/\n```\s*$/,"");
    const script = H.takeLocation(H.noDash(raw.trim()));
    return {script, locPlace: document.getElementById("locPlace").value, locCountry: document.getElementById("locCountry").value};
  }, raw)));
} else if (cmd === "clean-caption") {
  const raw = fs.readFileSync(opt.in, "utf8");
  out(await withHQ(base(opt.type, opt.fileno), page => page.evaluate(raw => { const H = window.PSHQ;
    raw = raw.replace(/^\s*```[a-z]*\s*\n/i, "").replace(/\n```\s*$/,"");
    const caption = H.fixQuotes(H.cleanTags(H.tiktokCaption(H.noDash(raw.trim()))));
    return {caption, chars: caption.length, over: caption.length > H.CAP_LIMIT};
  }, raw)));
} else if (cmd === "shorten-prompt") {
  const cap = fs.readFileSync(opt.in, "utf8").trim();
  out(await withHQ(base("file"), page => page.evaluate(cap => { const H = window.PSHQ; return {prompt: H.SHORTEN_RULES.replace("{N}", String(H.CAP_LIMIT - 60)) + cap}; }, cap)));
} else if (cmd === "lint") {
  const p = readJson(opt.packet);
  const report = opt.report ? readJson(opt.report) : null;
  const r = await withHQ(Object.assign(base(p.type, p.fileno), {script: p.script || "", caption: p.caption || ""}), page => page.evaluate(([p]) => { const H = window.PSHQ;
    const issues = [], warnings = [];
    const slides = H.parseScript(p.script || "");
    const body = slides.slice(); if (slides.length) slides.push({type: "end", text: "", items: [], notes: []});
    const tm = H.timingInfo(slides);
    const types = body.map(s => s.type);
    const plainAll = [p.script, p.caption, p.pinned].join("\n");
    if (!body.length) issues.push("the script has no slides");
    if (types[0] !== "hook") issues.push("the first slide must be the HOOK");
    if (!types.includes("status")) issues.push("no CASE STATUS slide");
    if (!types.includes("receipts")) issues.push("no RECEIPTS slide");
    const rec = body.find(s => s.type === "receipts");
    if (rec && !rec.items.length) issues.push("the RECEIPTS slide lists no sources");
    if (p.type === "memo" && !types.includes("take")) warnings.push("a Memo usually has a TAKE slide");
    H.wordIssues(slides).forEach(t => issues.push(t));
    H.emphasisIssues(slides).forEach(t => issues.push(t));
    if (tm.pre > 40) issues.push(`${Math.round(tm.pre)} s before the receipts (aim for 40 s or less)`);
    if (H.dashes(plainAll)) issues.push("contains an em dash");
    if (/\bwake\s*up\b/i.test(plainAll)) issues.push('uses "WAKE UP" (banned catchphrase)');
    if (/\bfollow\s+the\s+money\b/i.test(plainAll)) issues.push('uses "FOLLOW THE MONEY" (banned catchphrase)');
    const hook = body[0] ? body[0].text : "";
    const stock = ["TOP SECRET", "CLASSIFIED", "DO YOUR OWN RESEARCH", "CONNECT THE DOTS", "WHO BENEFITS"].filter(c => hook.toUpperCase().includes(c));
    if (stock.length > 1) issues.push("the hook uses more than one stock catchphrase: " + stock.join(", "));
    const cap = String(p.caption || "");
    const tags = cap.match(/#[\wÀ-ɏ]+/g) || [];
    const banned = tags.filter(t => H.BANNED_TAGS.includes(t.toLowerCase()));
    if (banned.length) issues.push("banned hashtags: " + banned.join(" "));
    if (tags.length > 5) issues.push(`${tags.length} hashtags (5 or fewer)`);
    if (!tags.map(t => t.toLowerCase()).includes("#plainsightfile")) issues.push("caption is missing #plainsightfile");
    if (cap.length > H.CAP_LIMIT) issues.push(`caption is ${cap.length} characters (cap ${H.CAP_LIMIT})`);
    else if (cap.length > 1200) warnings.push(`caption is ${cap.length} characters (aim 500 to 1,200)`);
    if (cap.length < 500) warnings.push(`caption is ${cap.length} characters (aim 500 to 1,200)`);
    if (/\n/.test(cap.trim())) issues.push("caption has line breaks");
    const num = (p.type === "memo" ? "Memo" : "File") + " No. " + p.fileno;
    if (!cap.includes(num)) issues.push(`caption does not include "${num}"`);
    if (p.type === "memo" && !/^Opinion:/.test(cap.trim())) issues.push('a Memo caption must begin with "Opinion: "');
    if (!/^\d{3,}$/.test(String(p.fileno || ""))) issues.push("number must be 3 or more digits");
    const pin = String(p.pinned || "");
    if (!pin) issues.push("no pinned comment");
    if (pin.length > 150) issues.push(`pinned comment is ${pin.length} characters (max 150)`);
    return {issues, warnings, stats: {slides: slides.length, secs_before_receipts: +tm.pre.toFixed(1), secs_total: +tm.total.toFixed(1), caption_chars: cap.length, pinned_chars: pin.length, hashtags: tags.length, types}};
  }, [p]));
  if (report) {
    if (String(report.fileno) !== String(p.fileno)) r.issues.push(`video was built as No. ${report.fileno}, packet says ${p.fileno}`);
    if (report.blocked_requests && report.blocked_requests.length) r.warnings.push("render tried to reach: " + report.blocked_requests.join(", "));
    if (report.container && report.container.duration_s > 60) r.warnings.push(`video is ${Math.round(report.container.duration_s)} s (over 60 s)`);
    if (report.audio && /placeholder/.test(String(report.audio.source))) r.issues.push("video was built with the placeholder drone, not the licensed track");
    r.stats.video_s = report.container && report.container.duration_s;
  }
  if (r.pageErrors) r.issues.push("HQ page errors: " + r.pageErrors.join(" | "));
  r.ok = r.issues.length === 0;
  out(r);
} else {
  console.error("usage: node hq_tool.mjs <prompts|clean-script|clean-caption|shorten-prompt|lint|hash> [options]");
  process.exit(2);
}

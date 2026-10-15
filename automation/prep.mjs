#!/usr/bin/env node
/*
  prep.mjs: small, deterministic helpers for the producer and publisher runs, so the bookkeeping is code, not memory.

  node prep.mjs numbers   --files files.json --queue queue.json
        -> {file:"006", memo:"003"}   next numbers (highest used in HQ's files and queue, plus one)
  node prep.mjs checker-prompt --packet packet.json --story story.json --frames <dir> [--sources <dir of fetched source texts>]
                               [--prior-script old.txt [--prior-caption old.txt] [--prior-pinned old.txt]]   (re-check of changes only)
                               [--mode recheck]                                                              (words unchanged, sources may have moved)
        -> the filled CHECKER.md text (stdout, plain text). With no mode it is a full check. With --prior-* it tells the checker which
           slides, caption or pinned comment changed since the last full check and lists only those frames. With --mode recheck it
           re-verifies everything against current sources but lists no frames and skips the joke check.
  (timings and agent-call counts for a run: see steplog.mjs)
  node prep.mjs queue-doc --packet packet.json --story story.json --checker checker.json --lint lint.json
                          --slot noon|evening --date YYYY-MM-DD --summary summary.json --rounds N [--note "..."]
                          [--merge-prior old-queue-doc.json | earlier-checker.json]   (after a check of changes only: keep the earlier quotes, joke score and notices)
                          [--reworded]                         (adds a Notes line: wording edited after the fact check, diff clean)
        -> the queue document (JSON) with status, extra-check reasons and hash
  node prep.mjs taken     --metricool posts.json --queue queue.json --exclude <docId>
        -> ["ISO", ...] times already used by other posts (for slot.mjs --taken)
  node prep.mjs metricool --doc doc.json --url <public mp4 url> --when <ISO> [--test]
        -> {blogId, date, info}   arguments for Metricool createScheduledPost (info is the JSON string it wants)

  JSON inputs may be a bare object/array, an ArtifactData export ({id, data}), or {docs:[...]}.
*/
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {packetHash} from "../builder/packet_hash.mjs";
import {factDiff} from "../builder/factdiff.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);
const opt = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith("--")) { const k = rest[i].slice(2); const v = rest[i + 1]; if (v === undefined || v.startsWith("--")) opt[k] = true; else { opt[k] = v; i++; } }
const unwrap = j => (j && j.data && typeof j.data === "object" && !Array.isArray(j.data) ? Object.assign({id: j.id}, j.data) : j);
const readAny = p => JSON.parse(fs.readFileSync(p, "utf8"));
const readOne = p => unwrap(readAny(p));
const readList = p => { if (!p || !fs.existsSync(p)) return [];
  if (fs.statSync(p).isDirectory()) return fs.readdirSync(p).filter(f => f.endsWith(".json")).map(f => readOne(path.join(p, f)));
  if (!fs.readFileSync(p, "utf8").trim()) return []; let j = readAny(p); if (j && Array.isArray(j.docs)) j = j.docs; if (j && Array.isArray(j.data)) j = j.data; if (!Array.isArray(j)) j = Object.entries(j).map(([id, v]) => Object.assign({id}, v)); return j.map(unwrap); };
const arr = x => (Array.isArray(x) ? x : []);
const todayVan = () => new Intl.DateTimeFormat("en-CA", {timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit"}).format(new Date());
const label = p => (p.type === "memo" ? "Memo" : "File") + " No. " + p.fileno;
const out = o => process.stdout.write((typeof o === "string" ? o : JSON.stringify(o, null, 2)) + "\n");

if (cmd === "numbers") {
  const all = [...readList(opt.files), ...readList(opt.queue)];
  const next = t => { let hi = 0; all.forEach(d => { if ((d.type === "memo" ? "memo" : "file") === t) { const n = parseInt(d.fileno, 10); if (n > hi) hi = n; } }); return String(hi + 1).padStart(3, "0"); };
  out({file: next("file"), memo: next("memo")});
} else if (cmd === "checker-prompt") {
  const p = readOne(opt.packet), s = readOne(opt.story);
  let frames = opt.frames && fs.existsSync(opt.frames) ? fs.readdirSync(opt.frames).filter(f => /\.png$/i.test(f)).sort().map(f => path.resolve(opt.frames, f)) : [];
  /* Scope: a full check, a check of what changed since the last one, or a re-check of sources for unchanged words. */
  const same = (a, b) => String(a || "").replace(/\s+/g, " ").trim() === String(b || "").replace(/\s+/g, " ").trim();
  let mode = opt.mode === "recheck" ? "recheck" : opt["prior-script"] ? "changed" : "full";
  let changedParts = [];
  if (mode === "changed") {
    const d = factDiff(fs.readFileSync(opt["prior-script"], "utf8"), p.script || "");
    if (d.slidesBefore !== d.slidesAfter) mode = "full";   /* the structure moved: check everything */
    else {
      d.changedSlides.forEach(n => changedParts.push("slide " + n));
      if (opt["prior-caption"] && !same(fs.readFileSync(opt["prior-caption"], "utf8"), p.caption)) changedParts.push("the caption");
      if (!opt["prior-caption"] && p.caption) changedParts.push("the caption");
      if (opt["prior-pinned"] && !same(fs.readFileSync(opt["prior-pinned"], "utf8"), p.pinned)) changedParts.push("the pinned comment");
      if (!changedParts.length) mode = "recheck";            /* nothing changed: only the sources can have moved */
      else frames = frames.filter(f => d.changedSlides.some(n => path.basename(f).startsWith(String(n).padStart(2, "0") + "-")));
    }
  }
  if (mode === "recheck") frames = [];
  const SCOPES = {
    full: "",
    changed: `SCOPE: RE-CHECK OF CHANGES. This post was fully fact-checked before. Only these parts changed since then: ${changedParts.join(", ")}. ("Slide N" means the Nth block between the --- lines in SLIDES below; block 1 is the HOOK.)
- Do STEPS 1 to 7 for the changed parts only. "claims" and "quotes" list changed parts only.
- Do not re-verify unchanged parts, except to FAIL a changed part that now contradicts an unchanged one, or that separates a claim from its limiting qualifier on another slide (the same-referent and screenshot tests still apply across slides).
- STEP 5: view only the frames listed under FRAMES (the changed slides). If none are listed, skip it and output "frames": [].
- STEP 8: skip it and output "comedy": null.
- riskiest_claim: the riskiest claim among the changed parts.
`,
    recheck: `SCOPE: RE-CHECK OF SOURCES. The words of this post have not changed since it was fully checked. The sources may have. Re-verify every claim against the sources as they are now (STEPS 1 to 4 and 5b to 7) and report any update or correction notice in source_changes. The frames are unchanged and were checked before: skip STEP 5 and output "frames": []. STEP 8: skip it and output "comedy": null.
`
  };
  const src = [];
  arr(s.receipts).forEach(r => src.push(`- ${r.cite || r.label || ""} [${r.kind || ""}] ${r.url || ""}${r.note ? " (" + r.note + ")" : ""}`));
  if (arr(s.facts).length) { src.push("", "Story desk facts (leads, not evidence):"); arr(s.facts).forEach(f => src.push("- " + f)); }
  if (s.gap) src.push("", "Gap as filed: " + s.gap);
  if (s.falsity_evidence) src.push("", "Evidence the claim is false or harmful, as filed: " + s.falsity_evidence);
  if (s.institution_response) src.push("", "Institution's response as filed: " + s.institution_response);
  if (s.strongest_caveat) src.push("", "Strongest caveat as filed: " + s.strongest_caveat);
  if (s.narrative_echo) src.push("", "This is a narrative-echo topic.");
  const t = fs.readFileSync(path.join(HERE, "CHECKER.md"), "utf8")
    .replace("{SCOPE}", () => SCOPES[mode])
    .replace("{TODAY}", todayVan()).replace("{NUMBER}", label(p)).replace("{FRAMES}", () => frames.length ? frames.join(", ") : "(none: skip STEP 5)")
    .replace("{SAVED}", opt.sources && fs.existsSync(opt.sources) ? (fs.readdirSync(opt.sources).filter(f => /\.(txt|md)$/i.test(f)).sort().map(f => path.resolve(opt.sources, f)).join(", ") || "(none)") : "(none)")
    /* function replacements: a "$&" or "$'" inside a script (US$ amounts) must not be read as a replacement pattern */
    .replace("{SCRIPT}", () => p.script || "").replace("{CAPTION}", () => p.caption || "").replace("{PINNED}", () => p.pinned || "").replace("{SOURCES}", () => src.join("\n"));
  out(t);
} else if (cmd === "queue-doc") {
  const p = readOne(opt.packet), s = readOne(opt.story), ck = readOne(opt.checker), lint = readOne(opt.lint), sum = readAny(opt.summary);
  /* --merge-prior <old queue doc>: after a check of changes only, the checker reported on the changed parts. Keep what the earlier full
     check established for the rest: direct quotes still in the post, the joke score, the allegation flag and any source notices. */
  if (opt["merge-prior"]) {
    const pr = readOne(opt["merge-prior"]), pc = pr.checker || (pr.verdict ? pr : {});   /* an old queue doc, or a raw checker.json */
    const nq = t => String(t || "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[*|]/g, "").replace(/^"|"$/g, "").replace(/\s+/g, " ").trim();
    const text = nq((p.script || "") + "\n" + (p.caption || "")), have = new Set(arr(ck.quotes).map(q => nq(q.quote)));
    ck.quotes = [...arr(ck.quotes), ...arr(pc.quotes).filter(q => q && q.quote && !have.has(nq(q.quote)) && text.includes(nq(q.quote)))];
    if (!ck.comedy && pc.comedy) ck.comedy = pc.comedy;
    if (!ck.riskiest_claim && pc.riskiest_claim) ck.riskiest_claim = pc.riskiest_claim;
    ck.allegation_present = !!(ck.allegation_present || pc.allegation_present);
    const seen = new Set(arr(ck.source_changes).map(x => x.url)); ck.source_changes = [...arr(ck.source_changes), ...arr(pc.source_changes).filter(x => !seen.has(x.url))];
  }
  const flags = arr(ck.flags), issues = arr(lint.issues);
  const reasons = [];
  if (s.narrative_echo) reasons.push("narrative-echo topic");
  if (s.verification !== "verified") reasons.push("no primary source read");
  if (ck.allegation_present) reasons.push("mentions an allegation");
  if (arr(ck.source_changes).length) reasons.push("a source has an update or correction notice");
  if (p.type === "memo") reasons.push("Memo (opinion)");
  const comedy = ck.comedy && typeof ck.comedy === "object" ? ck.comedy : null;
  const flat = !!(comedy && Number(comedy.score) > 0 && Number(comedy.score) < 3);
  const ok = ck.verdict === "PASS" && !flags.length && !issues.length && !flat;
  const now = new Date().toISOString();
  const {execFileSync} = await import("node:child_process");
  const slot = JSON.parse(execFileSync(process.execPath, [path.join(HERE, "slot.mjs"), "--day", opt.date, "--slot", opt.slot], {encoding: "utf8"}));
  const doc = {
    date: opt.date, slot: opt.slot, slotAt: slot.slotAt, type: p.type === "memo" ? "memo" : "file", fileno: p.fileno,
    title: s.title || "", storyId: s.id || "", summary: arr(sum.summary || sum).slice(0, 3), sourceLine: sum.sourceLine || s.sourceName || "",
    script: p.script, caption: p.caption, pinned: p.pinned, locPlace: p.locPlace || "", locCountry: p.locCountry || "", look: p.look || "auto",
    secs: lint.stats ? lint.stats.secs_total : null, slides: lint.stats ? lint.stats.slides : null,
    checker: {verdict: ck.verdict || "FLAG", flags, riskiest_claim: ck.riskiest_claim || null, quotes: arr(ck.quotes), allegation_present: !!ck.allegation_present,
      source_changes: arr(ck.source_changes), injection_suspected: arr(ck.injection_suspected), rounds: Number(opt.rounds || 1), checkedAt: now,
      comedy: comedy ? {score: Number(comedy.score) || null, best_line: comedy.best_line || "", flattest_slide: comedy.flattest_slide || "", suggestion: comedy.suggestion || ""} : null},
    lint: {issues, warnings: [...arr(lint.warnings),
      ...(opt.reworded ? ["Reworded after the fact check. An automatic diff found no change to numbers, quoted words, names, SOURCE lines, qualifiers or receipts, but the checker has not re-read the new wording."] : [])]},
    tick: {required: reasons.length > 0, reasons},
    status: ok ? "ready" : "needs_you",
    statusNote: ok ? (opt.note || "") : (issues.length ? "Checks still failing: " + issues.join("; ")
      : flags.length || ck.verdict !== "PASS" ? "The checker flagged something it couldn't clear. See below."
      : "Accurate, but the joke check says it's flat (" + comedy.score + "/5). Use Fix with a note, or approve if you like it."),
    hash: packetHash(p), createdAt: now, updatedAt: now,
    approvedAt: null, approvedHash: null
  };
  out(doc);
} else if (cmd === "taken") {
  const times = [];
  arr(readAny(opt.metricool).data || readAny(opt.metricool)).forEach(x => {
    const dt = x.publicationDate && x.publicationDate.dateTime; if (!dt || x.draft) return;
    if (!arr(x.providers).some(p => p.network === "tiktok")) return;
    times.push({local: dt, tz: x.publicationDate.timezone || "America/Vancouver"});
  });
  const res = [];
  /* Metricool gives local wall time; slot.mjs takes ISO with offset: convert via the same helper. */
  const {execFileSync} = await import("node:child_process");
  for (const t of times) {
    const [d, hm] = t.local.split("T");
    const r = JSON.parse(execFileSync(process.execPath, [path.join(HERE, "slot.mjs"), "--day", d, "--slot", "noon"], {encoding: "utf8"}));
    const off = r.slotAt.slice(19); res.push(`${d}T${hm.slice(0, 8)}${off}`);
  }
  readList(opt.queue).forEach(q => {
    if (q.id === opt.exclude) return;
    if (["approved", "publishing", "scheduled", "posted"].includes(q.status) && q.publish && q.publish.scheduledFor) res.push(q.publish.scheduledFor);
    else if (["ready", "needs_you", "fixing", "approved", "publishing"].includes(q.status) && q.slotAt && new Date(q.slotAt) > new Date()) res.push(q.slotAt);
  });
  out([...new Set(res)]);
} else if (cmd === "metricool") {
  const d = readOne(opt.doc), when = String(opt.when);
  const local = when.slice(0, 19);
  const cap = String(d.caption || "");
  if (cap.length > 2200) throw new Error("caption over TikTok's 2,200 characters");
  const info = {
    autoPublish: true, draft: !!opt.test, descendants: [], firstCommentText: "", hasNotReadNotes: false,
    media: [String(opt.url)], mediaAltText: [], providers: [{network: "tiktok"}],
    publicationDate: {dateTime: local, timezone: "America/Vancouver"}, shortener: false, smartLinkData: {ids: []},
    text: cap,
    /* Metricool requires a TikTok title. For a video, TikTok's own API calls the caption the "title", so it carries the
       full caption too (accepted at 754 characters in the October 14 test), whichever field Metricool sends. */
    tiktokData: {disableComment: false, disableDuet: true, disableStitch: true, privacyOption: opt.test ? "SELF_ONLY" : "PUBLIC_TO_EVERYONE",
      commercialContentThirdParty: false, commercialContentOwnBrand: false, title: cap, autoAddMusic: false, isAigc: false}
  };
  out({blogId: "7150125", date: when, info: JSON.stringify(info)});
} else {
  console.error("usage: node prep.mjs <numbers|checker-prompt|queue-doc|taken|metricool> [options]");
  process.exit(2);
}

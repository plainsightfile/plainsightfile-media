#!/usr/bin/env node
/*
  saycheck.mjs: the narrator's SAY: lines, checked by code. Pure text, no browser.

    node saycheck.mjs strip --in script.txt                      -> the script with every SAY: line removed (stdout)
    node saycheck.mjs check --before script.txt --after said.txt -> {ok, issues[], warnings[], lines[]} (JSON)

  A SAY: line is what the narrator (Rhea Dacted) speaks while that slide is on screen. It is never printed, so the slide text must come
  through the narrator step untouched, and the spoken line must not say more than its own slide does:
    - removing the SAY: lines from --after must give --before exactly (the narrator may only add lines)
    - every slide except RECEIPTS has exactly one SAY: line (RECEIPTS may have one)
    - every number (digits or number words) and every quoted passage in a SAY: line appears on that same slide
    - no cause, intent or guilt word (factdiff's list) that the slide does not already use
    - no banned catchphrase, no em dash, at most 20 words (a warning above 15)
    - capitalised names in a SAY: line appear somewhere in the script
  It is a safety net, not a fact check: the independent checker still reads every SAY: line against the sources.
*/
import fs from "node:fs";
import {BANNED, STRENGTHENERS, NUM_WORDS, splitSlides} from "./factdiff.mjs";

export const SAY_RE = /^[\s*_]*SAY[*_]*\s*[:：][*_]*\s*/i;
export const stripSay = s => String(s || "").replace(/\r/g, "").split("\n").filter(l => !SAY_RE.test(l)).join("\n");

const straight = s => String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
const flat = s => straight(s).replace(/[*|_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const numbers = s => (straight(s).replace(/,(?=\d{3})/g, "").match(new RegExp(`\\d+(?:\\.\\d+)?|\\b(?:${NUM_WORDS})\\b`, "gi")) || []).map(x => x.toLowerCase());
const quotes = s => [...straight(s).matchAll(/"([^"]{2,})"/g)].map(m => flat(m[1]));
const has = (hay, w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i").test(hay);

export function sayCheck(before, after) {
  const issues = [], warnings = [], lines = [];
  if (flat(stripSay(after)) !== flat(before.replace(/\r/g, "").split("\n").filter(l => !SAY_RE.test(l)).join("\n")))
    issues.push("the narrator changed the slide text (only SAY: lines may be added)");
  const whole = flat(stripSay(after));
  splitSlides(after).forEach((chunk, i) => {
    const n = i + 1, rows = chunk.split("\n");
    const says = rows.filter(l => SAY_RE.test(l)).map(l => l.replace(SAY_RE, "").trim());
    const slide = rows.filter(l => !SAY_RE.test(l)).join("\n"), slideFlat = flat(slide);
    const isReceipts = /^\s*[*_]*\s*RECEIPTS\s*[*_]*\s*:/i.test(slide);
    if (says.length > 1) issues.push(`slide ${n}: ${says.length} SAY: lines (one per slide)`);
    if (!says.length) { if (!isReceipts) issues.push(`slide ${n}: no SAY: line`); return; }
    const say = says.join(" ");
    lines.push({slide: n, say, words: say.split(/\s+/).filter(Boolean).length});
    const words = lines[lines.length - 1].words;
    if (words > 20) issues.push(`slide ${n}: SAY: line is ${words} words (at most 20)`);
    else if (words > 15) warnings.push(`slide ${n}: SAY: line is ${words} words (aim for 15 or fewer)`);
    if (/—/.test(say)) issues.push(`slide ${n}: em dash in the SAY: line`);
    const slideNums = numbers(slide);
    numbers(say).forEach(x => { if (!slideNums.includes(x)) issues.push(`slide ${n}: SAY: line has "${x}", which is not on the slide`); });
    quotes(say).forEach(q => { if (!slideFlat.includes(q)) issues.push(`slide ${n}: SAY: line quotes "${q}", which is not on the slide word for word`); });
    STRENGTHENERS.forEach(w => { if (has(say, w) && !has(slide, w)) issues.push(`slide ${n}: SAY: line adds "${w}", which the slide does not say`); });
    BANNED.forEach(w => { if (has(say, w)) issues.push(`slide ${n}: banned phrase "${w}" in the SAY: line`); });
    /* capitalised words that are not the start of a sentence: names must already be in the script */
    straight(say).replace(/(^|[.!?:]\s+)[A-Z][\w']*/g, "$1").match(/\b[A-Z][a-zA-Z'.-]{2,}\b/g)?.forEach(w => {
      if (!whole.includes(w.toLowerCase().replace(/'s$/, ""))) issues.push(`slide ${n}: SAY: line names "${w}", which is not in the script`); });
  });
  return {ok: !issues.length, issues, warnings, lines};
}

if (process.argv[1] && import.meta.url === new URL("file://" + fs.realpathSync(process.argv[1])).href) {
  const [cmd, ...rest] = process.argv.slice(2); const opt = {};
  for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, "")] = rest[i + 1];
  if (cmd === "strip") process.stdout.write(stripSay(fs.readFileSync(opt.in, "utf8")));
  else if (cmd === "check") process.stdout.write(JSON.stringify(sayCheck(fs.readFileSync(opt.before, "utf8"), fs.readFileSync(opt.after, "utf8")), null, 2) + "\n");
  else { console.error("usage: node saycheck.mjs strip --in script.txt | check --before script.txt --after said.txt"); process.exit(2); }
}

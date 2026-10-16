/*
  factdiff.mjs: compare two versions of a slide script and say whether anything that carries a FACT changed.
  Pure text, no browser. Used by hq_tool.mjs (`factdiff`) and automation/prep.mjs (which parts changed since the last check).

  It is a safety net for WORDING-ONLY edits (the punch-up editor, a joke retry). It does not prove a script is true.
  It proves the edit did not touch what the fact-checker already verified: per slide, the numbers, quoted words,
  SOURCE and CLASSIFIED LOCATION lines, limiting qualifiers, negations, attribution words ("says", "alleged") and
  cause/intent words; across the script, the proper names; and the whole RECEIPTS slide.

  A script is split into slides the same way HQ does it: blocks separated by a line holding only ---.
  DEVICE:, LOCATION: and STAMP: lines are furniture and are ignored.
*/

export const BANNED = ["wake up", "follow the money", "sheeple", "cover-up", "cover up", "rigged", "tinfoil"];

/* Words that limit or attribute a claim: a slide may add them, never lose them. */
export const QUALIFIERS = ["estimate", "estimates", "estimated", "alleged", "allegedly", "allegation", "allegations", "reportedly", "preliminary",
  "provisional", "approximately", "roughly", "at least", "up to", "may", "might", "could", "denied", "denies", "disputed", "disputes",
  "say", "says", "said", "claim", "claims", "claimed", "according to", "not", "no", "never", "without", "none", "n't"];
/* Words that assert cause, intent or a finding: a slide may lose them, never gain them. */
export const STRENGTHENERS = ["because", "caused", "causes", "causing", "led to", "leading to", "to hide", "hid", "hiding", "concealed", "covered up",
  "lied", "knew", "knowingly", "deliberately", "intentionally", "on purpose", "admitted", "confessed", "proved", "proves", "proof",
  "guilty", "convicted", "illegal", "corrupt", "corruption", "fraud", "ruled", "found", "concluded"];

export const NUM_WORDS = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|half|double|triple|twice|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth";

const straight = s => String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
/* text used for comparing: straight quotes, no emphasis stars or redaction bars, single spaces */
const norm = s => straight(s).replace(/[*|]/g, "").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();

export function splitSlides(script) {
  return String(script || "").replace(/\r/g, "").split(/^\s*---\s*$/m)
    .map(chunk => chunk.split("\n").filter(l => !/^\s*(DEVICE|LOCATION|STAMP)\s*:/i.test(l)).join("\n").trim())
    .filter(Boolean);
}
const labelOf = text => { const m = text.match(/^\s*([A-Z][A-Z ]{2,}?)\s*:/); return m ? m[1].trim() : "BODY"; };
const isExhibit = l => /^\s*(SOURCE|CLASSIFIED LOCATION)\s*:/i.test(l);

function counts(list) { const m = new Map(); list.forEach(x => m.set(x, (m.get(x) || 0) + 1)); return m; }
function mapDiff(a, b) { /* items whose count differs, as "x (n before, m after)" */
  const out = []; new Set([...a.keys(), ...b.keys()]).forEach(k => { const x = a.get(k) || 0, y = b.get(k) || 0; if (x !== y) out.push({item: k, before: x, after: y}); });
  return out;
}
function numbers(t) {
  const s = norm(t).replace(/(\d),(?=\d{3}\b)/g, "$1").toLowerCase();
  /* the label on a slide ("CASE STATUS:") and slide furniture are not facts; digits and number words are */
  const found = s.match(new RegExp(String.raw`(?:c\$|us\$|[€£$])?\d+(?:\.\d+)?%?|\b(?:${NUM_WORDS})\b`, "g")) || [];
  return found;
}
function quotes(t) { return (norm(t).match(/"[^"]+"/g) || []).map(q => q.replace(/\s+/g, " ")); }
function termCounts(t, terms) {
  const s = " " + norm(t).toLowerCase().replace(/[^a-z0-9'\- ]+/g, " ").replace(/\s+/g, " ") + " ";
  const m = new Map();
  terms.forEach(w => { const re = new RegExp(w === "n't" ? "n't\\b" : `(?<![a-z'-])${w.replace(/[-]/g, "\\-")}(?![a-z'-])`, "g"); const c = (s.match(re) || []).length; if (c) m.set(w, c); });
  return m;
}
/* Words that are only capitalised because they start a sentence: not names. */
const STARTERS = new Set(("the a an this that these those it its they their them he she his her we our you your i in on at for to of by with from as not no yes but and or so if when while " +
  "then now until which who what why how where every each all any only just still also even here there same more most less hidden leaked redacted classified secret top page source status case " +
  "receipts spin record take translation reveal hook").split(" "));
/* Proper names: capitalised words (the first word of a sentence counts unless it is an ordinary starter). All-caps words are costume, not names. */
function names(text) {
  const out = new Set();
  norm(text).split("\n").filter(l => !isExhibit(l)).forEach(line => {
    line = line.replace(/^\s*[A-Z][A-Z ]{2,}?\s*:\s*/, "");        /* slide label */
    line.split(/(?<=[.!?])\s+|:\s+/).forEach(sentence => {
      sentence.trim().split(/\s+/).forEach((w, i) => {
        const m = w.replace(/^[("]+/, "").match(/^[A-Z][a-z][A-Za-z'-]*/); if (!m) return;
        const name = m[0].replace(/'s?$/, "").toLowerCase();
        if (i === 0 && STARTERS.has(name)) return;
        out.add(name);
      });
    });
  });
  return out;
}

/** Compare two scripts. Returns {ok, reasons[], changedSlides[], unchangedSlides[], hookChanged, slidesBefore, slidesAfter}. */
export function factDiff(before, after) {
  const A = splitSlides(before), B = splitSlides(after), reasons = [];
  const changed = [], unchanged = [];
  if (A.length !== B.length) reasons.push(`slide count changed (${A.length} before, ${B.length} after)`);
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const a = A[i], b = B[i], at = `slide ${i + 1}`;
    if (norm(a) === norm(b)) { unchanged.push(i + 1); continue; }
    changed.push(i + 1);
    if (labelOf(a) !== labelOf(b)) reasons.push(`${at}: label changed (${labelOf(a)} to ${labelOf(b)})`);
    if (labelOf(a) === "RECEIPTS") { reasons.push(`${at}: the RECEIPTS slide must not change`); continue; }
    const d1 = mapDiff(counts(numbers(a)), counts(numbers(b))); if (d1.length) reasons.push(`${at}: numbers changed: ` + d1.map(x => `${x.item} (${x.before} to ${x.after})`).join(", "));
    const d2 = mapDiff(counts(quotes(a)), counts(quotes(b))); if (d2.length) reasons.push(`${at}: quoted words changed: ` + d2.map(x => x.item).join(" | "));
    const ea = norm(a).split("\n").filter(isExhibit), eb = norm(b).split("\n").filter(isExhibit);
    if (ea.join("\n") !== eb.join("\n")) reasons.push(`${at}: SOURCE or CLASSIFIED LOCATION line changed`);
    const qa = termCounts(a, QUALIFIERS), qb = termCounts(b, QUALIFIERS), lost = [];
    qa.forEach((c, w) => { if ((qb.get(w) || 0) < c) lost.push(w); }); if (lost.length) reasons.push(`${at}: qualifier or attribution lost: ${lost.join(", ")}`);
    const sa = termCounts(a, STRENGTHENERS), sb = termCounts(b, STRENGTHENERS), gained = [];
    sb.forEach((c, w) => { if ((sa.get(w) || 0) < c) gained.push(w); }); if (gained.length) reasons.push(`${at}: cause, intent or finding word added: ${gained.join(", ")}`);
  }
  const na = names(A.join("\n---\n")), nb = names(B.join("\n---\n"));
  const lostN = [...na].filter(x => !nb.has(x)), newN = [...nb].filter(x => !na.has(x));
  if (lostN.length) reasons.push("names no longer present: " + lostN.join(", "));
  if (newN.length) reasons.push("new names: " + newN.join(", "));
  const lower = norm(B.join("\n")).toLowerCase(), lowerA = norm(A.join("\n")).toLowerCase();
  BANNED.forEach(p => { if (lower.includes(p) && !lowerA.includes(p)) reasons.push(`banned phrase added: "${p}"`); });
  return {ok: reasons.length === 0, reasons, changedSlides: changed, unchangedSlides: unchanged, hookChanged: changed.includes(1),
    slidesBefore: A.length, slidesAfter: B.length};
}

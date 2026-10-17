#!/usr/bin/env node
/*
  slot.mjs: when an approved post should go out.

  node slot.mjs --slot-at <ISO> [--taken taken.json] [--now <ISO>]
    taken.json: array of ISO times of other posts already scheduled or published (Metricool) or approved (queue).
  Prints {scheduledFor, local, reason}.

  Rules (Alex, October 14, 2026; one post a day at 7 PM Pacific since October 17): an unapproved post holds for the next slot.
  - Its own slot, if that is still at least LEAD minutes away.
  - Approved up to GRACE minutes after its slot: as soon as possible (now + LEAD, rounded up to 5 minutes).
  - Otherwise the next free daily slot.
  - Never within GAP hours of another post.
  Also: node slot.mjs --day YYYY-MM-DD --slot noon|evening  prints that slot's ISO time (for the producer).
*/
const TZ = "America/Vancouver", SLOTS = {noon: [12, 0], evening: [19, 0]};
const LEAD = 10, GRACE = 60, GAP = 3;
const args = {}; const a = process.argv.slice(2);
for (let i = 0; i < a.length; i++) if (a[i].startsWith("--")) args[a[i].slice(2)] = a[i + 1];
import fs from "node:fs";

function offsetMin(date) {
  const p = new Intl.DateTimeFormat("en-US", {timeZone: TZ, timeZoneName: "longOffset"}).formatToParts(date).find(x => x.type === "timeZoneName").value;
  const m = p.match(/GMT([+-])(\d{2}):?(\d{2})?/); if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
}
/* local wall time in Vancouver -> Date */
function at(y, mo, d, h, mi) {
  let guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  for (let i = 0; i < 2; i++) guess = new Date(Date.UTC(y, mo - 1, d, h, mi) - offsetMin(guess) * 60e3);
  return guess;
}
function localParts(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"}).formatToParts(date).map(x => [x.type, x.value]));
  return p;
}
export function iso(date) {
  const p = localParts(date), off = offsetMin(date), s = off < 0 ? "-" : "+", o = Math.abs(off);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${s}${String(Math.floor(o / 60)).padStart(2, "0")}:${String(o % 60).padStart(2, "0")}`;
}
const local = d => { const p = localParts(d); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`; };

if (args.day) {
  const [y, mo, d] = args.day.split("-").map(Number), [h, mi] = SLOTS[args.slot || "noon"];
  const t = at(y, mo, d, h, mi);
  console.log(JSON.stringify({slotAt: iso(t), local: local(t)}));
  process.exit(0);
}
const now = args.now ? new Date(args.now) : new Date();
const slotAt = new Date(args["slot-at"]);
const taken = (args.taken && fs.existsSync(args.taken) ? JSON.parse(fs.readFileSync(args.taken, "utf8")) : []).map(t => new Date(t)).filter(t => !isNaN(t));
const free = t => taken.every(x => Math.abs(x - t) >= GAP * 3600e3);
const earliest = new Date(now.getTime() + LEAD * 60e3);
let pick = null, reason = "";
if (slotAt >= earliest) { pick = slotAt; reason = "its own slot"; }
else if (now - slotAt <= GRACE * 60e3) { pick = new Date(Math.ceil(earliest.getTime() / 300e3) * 300e3); reason = "approved just after its slot: as soon as possible"; }
if (pick && !free(pick)) { reason = (reason ? reason + " was " : "") + "too close to another post"; pick = null; }
if (!pick) {
  const p = localParts(now);
  for (let day = 0; day < 4 && !pick; day++) {
    const base = new Date(Date.UTC(+p.year, +p.month - 1, +p.day + day));
    for (const [h, mi] of [SLOTS.evening]) { /* one post a day at 7 PM since October 17, 2026 */
      const t = at(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h, mi);
      if (t >= earliest && free(t)) { pick = t; reason = (reason ? reason + "; " : "") + "next free slot"; break; }
    }
  }
}
if (!pick) { console.log(JSON.stringify({error: "no free slot in the next 4 days"})); process.exit(1); }
console.log(JSON.stringify({scheduledFor: iso(pick), local: local(pick), reason}));

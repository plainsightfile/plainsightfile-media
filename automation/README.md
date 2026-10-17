# automation

The daily pipeline for @therhealitycheck. Nothing here posts without Alex's Approve tap in Plain Sight HQ.

| Step | Who | When |
|---|---|---|
| Story pull | scheduled task "Plain Sight story pull" | 4:52 AM Pacific |
| Producer ([PRODUCER.md](PRODUCER.md)) | scheduled task "Plain Sight producer" | 5:22 AM Pacific, and on Fix |
| Approve | Alex, in HQ's Approve tab | any time; posts at noon (File) and 7 PM (Memo) |
| Publisher ([PUBLISHER.md](PUBLISHER.md)) | scheduled task "Plain Sight publisher" | on Approve and Pause; confirms at 12:35 and 7:35 PM |

Helpers: `slot.mjs` (posting times), `prep.mjs` (numbers, checker prompt in full, changes-only or sources-only form, queue documents, Metricool arguments), `push_media.sh` (hosts the one video being scheduled on the `media` branch), `CHECKER.md` (the independent fact-checker's prompt), `JOKECHECK.md` (the small, tool-less joke scorer used after a joke retry), `steplog.mjs` (stopwatch and subagent-call counts; the producer stores them in HQ's `meta/producer` as `timings`). The writer prompts and every text rule come from HQ itself (`../builder/hq.html`, run headlessly by `../builder/hq_tool.mjs`). `../builder/factdiff.mjs` tells whether an edit changed wording only (numbers, quoted words, names, SOURCE lines, qualifiers, receipts untouched).

How the producer keeps its cost down: the File and the Memo are made side by side; drafts render frames only (about 5 s) and the publisher builds the one real video; the first check is full, a second check covers only what changed; a joke retry is checked by code (`factdiff`) and a small scorer instead of a second full fact check when it changed wording only; captions use a lighter model; a Fix or Recheck does only as much as the change needs.

The licensed music track lives in the private repo `plainsightfile-private`, never here.

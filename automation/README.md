# automation

The daily pipeline for The Rhea Lity Check (@therhealitycheck). Nothing posts without Alex's Approve tap in HQ.
Lean since October 17, 2026: one post a day, one Claude run a day, one independent fact-check.

| Step | Who | When |
|---|---|---|
| Daily run ([DAILY.md](DAILY.md)): find one viral claim, verify it, write and check tonight's post | scheduled task "Rhea Lity daily run" | 5:22 AM Pacific; also Fix, Recheck and HQ's Update stories (PULL) |
| Approve | Alex, in HQ's Approve tab | any time; posts at 7 PM |
| Publisher ([PUBLISHER.md](PUBLISHER.md)): builds the video and schedules it | scheduled task "Rhea Lity publisher" | on Approve and Pause; confirms at 7:35 PM |
| Do it yourself, no Claude needed | `manual/` + the make-video GitHub Action | any time |

Helpers: `slot.mjs` (the 7 PM slot), `prep.mjs` (numbers, the checker prompt in full or changes-only form, queue documents, Metricool arguments), `push_media.sh` (hosts the video being scheduled on the `media` branch), `CHECKER.md` (the independent fact-checker), `NARRATOR.md` (Rhea's voice rules), `voice.json` (ElevenLabs Peach settings), `blocked_sources.json`. The slide and caption rules come from HQ itself (`../builder/hq.html`, run headlessly by `../builder/hq_tool.mjs`).

The licensed music track lives in the private repo `plainsightfile-private`, never here.

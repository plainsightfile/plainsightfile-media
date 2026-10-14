# automation

The daily pipeline for @plainsightfile. Nothing here posts without Alex's Approve tap in Plain Sight HQ.

| Step | Who | When |
|---|---|---|
| Story pull | scheduled task "Plain Sight story pull" | 4:52 AM Pacific |
| Producer ([PRODUCER.md](PRODUCER.md)) | scheduled task "Plain Sight producer" | 5:22 AM Pacific, and on Fix |
| Approve | Alex, in HQ's Approve tab | any time; posts at noon (File) and 7 PM (Memo) |
| Publisher ([PUBLISHER.md](PUBLISHER.md)) | scheduled task "Plain Sight publisher" | on Approve and Pause; confirms at 12:35 and 7:35 PM |

Helpers: `slot.mjs` (posting times), `prep.mjs` (numbers, checker prompt, queue documents, Metricool arguments), `push_media.sh` (hosts the one video being scheduled on the `media` branch), `CHECKER.md` (the independent fact-checker's prompt). The writer prompts and every text rule come from HQ itself (`../builder/hq.html`, run headlessly by `../builder/hq_tool.mjs`).

The licensed music track lives in the private repo `plainsightfile-private`, never here.

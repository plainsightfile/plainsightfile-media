# plainsightfile-media

Support repository for @plainsightfile ("Hidden in Plain Sight") on TikTok.

- `builder/`: renders an approved File into a finished TikTok MP4 using the same slide code as Plain Sight HQ (`builder/hq.html`), Playwright and ffmpeg. Usage: `cd builder && npm ci && node build_video.mjs <script.txt|file.json> --fileno 012 [--music track.mp3] --out out/file-012`.
- `media/`: finished videos sit here briefly so Metricool can copy them for scheduling. They are removed afterwards.

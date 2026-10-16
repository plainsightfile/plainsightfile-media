# Narrator prompt (the SAY: lines the narrator speaks)

The producer fills {SCRIPT} with the finished slide script (SAY: lines removed with `node $M/builder/saycheck.mjs strip`) and {OLD} with the previous SAY: lines, if any, one per line as "slide N: <line>" (or "none"). Give the whole text to a NEW subagent (MAIN; it uses no tools). Its reply goes through `saycheck.mjs check`.

```text
You write the spoken narration for a TikTok slideshow video from "Hidden in Plain Sight" (@plainsightfile). The account presents TRUE, sourced public-record stories dressed up as a "they don't want you to know" conspiracy post; the joke is always that the "secret" was public all along.

The narrator is a casual, quick British woman (the ElevenLabs voice "Peach") who has read every "secret" and found them all in press releases. She is friendly and a bit cheeky: the sass is aimed at the "they don't want you to know" costume and at how boringly public the record is, never at ordinary people, victims or the viewer. Think "mate, it's literally on their website". A text-to-speech voice reads exactly what you write, so write for the ear.

YOUR JOB: add exactly one line starting "SAY: " at the end of every slide (the RECEIPTS slide too). Copy every other line of the script exactly as it is, character for character. Add nothing else.

HOW SHE TALKS
- The SAY: lines are read back to back in ONE continuous take, so write one little monologue that happens to be cut into slides, not a caption per slide. Each line should follow on from the one before, the way you would tell a friend about something you read ("So...", "But here's the thing...", "And the best part?", "Which, fair enough...").
- Write how people actually talk: whole, relaxed sentences with contractions ("it's", "they've", "that's"). At most one clipped fragment per line. Never stack fragments like "Accounts clean. Spending adverse. Not fraud." That is how slides read, not how people speak.
- Don't read the slide or its label out (no "Case status.", "Reveal.", "Source:"). The slide carries the detail; her voice carries the point.
- Talk to the viewer now and then ("you'd think...", "go on, guess"), but never tell them what to think about a person.
- 6 to 15 words per line (hook 12 or fewer). Never more than 20. Short is funnier, and the whole video must stay well under 60 seconds.
- The sass lives in small asides and reactions that carry no fact: "love that", "bold", "classic", "shocking, I know", "fair enough", "honestly", "mind you", "anyway". Fold them into the sentence ("Seventh year running, which is honestly impressive.") rather than tacking a one-word sentence on the end every time. At most one per line, never the same one twice in a video.
- Costume words (TOP SECRET, LEAKED, CLASSIFIED and the rest) she says knowingly, as if reading a label on a box: the contrast is the joke. Never shout, never "wake up", never insult anyone named.
- Plain punctuation only: full stops, commas, question marks. No em dashes, exclamation marks, emoji, stage directions or brackets.

EXAMPLE (same facts, two ways)
Stiff: "Accounts clean. Spending adverse, seventh year running. Not fraud."
Natural: "So the accounts are fine. The spending, though? Adverse, for the seventh year running. Not fraud, mind."

FACTS (non-negotiable; an independent fact-checker reads every SAY: line against the sources)
- Use ONLY what is on that same slide, including its SOURCE line. Never bring in a fact, name, number or source from another slide or from outside the script.
- Every number you say must appear on that slide, written the same way (digits as digits: "3.8%", "9 of 37", "US$1.2 billion"). Do not round, convert or spell out numbers.
- When you mention a claim, keep its limiting words with it: "auditors say", "estimate", "alleged", "not fraud", "recovery fund aside". Dropping a qualifier makes the line false.
- Quotation marks only around words that are on the slide inside quotation marks, word for word.
- No cause, intent or guilt words ("because", "led to", "hid", "knew", "lied", "covered up", "fraud" as an accusation) unless the slide itself says them.
- Never say the false or exaggerated version of a claim, not even as a joke or a question.
- RECEIPTS slide: one short line pointing at the record, e.g. "It's all in the auditors' annual report. Receipts are in the caption." The end card is not in the script; the video adds its sign-off by itself.

Previous SAY: lines (reuse a line unchanged when its slide's text has not changed):
{OLD}

Output ONLY the full script with the SAY: lines added.

Script:
{SCRIPT}
```

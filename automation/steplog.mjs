#!/usr/bin/env node
/*
  steplog.mjs: a tiny stopwatch for the producer run, so we can see where the minutes and the model calls go.

  node steplog.mjs mark <log.jsonl> <label> [--agent opus|sonnet|haiku]
        Append "this step just finished". The step's duration is the time since the previous mark in the same log.
        Pass --agent when the step was one subagent call, so calls are counted by model.
        The first mark in a log (label "start") only starts the clock.
  node steplog.mjs summary <log.jsonl> [<log2.jsonl> ...]
        -> {logs: {<file name>: {total_s, steps:[{label, s, agent}]}}, agent_calls, agents: {opus: n, sonnet: n}}
        Use one log per post (parallel posts would interleave) and one for the run's own steps.
*/
import fs from "node:fs";
import path from "node:path";

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "mark") {
  const [log, label, ...flags] = rest;
  if (!log || !label) { console.error("usage: node steplog.mjs mark <log.jsonl> <label> [--agent opus|sonnet|haiku]"); process.exit(2); }
  const i = flags.indexOf("--agent");
  fs.mkdirSync(path.dirname(path.resolve(log)), {recursive: true});
  fs.appendFileSync(log, JSON.stringify({t: Date.now(), label, agent: i > -1 ? flags[i + 1] : undefined}) + "\n");
} else if (cmd === "summary") {
  const res = {logs: {}, agent_calls: 0, agents: {}};
  rest.filter(f => fs.existsSync(f)).forEach(f => {
    const rows = fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    const steps = rows.slice(1).map((r, i) => ({label: r.label, s: +((r.t - rows[i].t) / 1000).toFixed(1), agent: r.agent}));
    steps.forEach(s => { if (s.agent) { res.agent_calls++; res.agents[s.agent] = (res.agents[s.agent] || 0) + 1; } });
    res.logs[path.basename(f)] = {total_s: rows.length > 1 ? +((rows[rows.length - 1].t - rows[0].t) / 1000).toFixed(1) : 0, steps};
  });
  process.stdout.write(JSON.stringify(res, null, 2) + "\n");
} else {
  console.error("usage: node steplog.mjs <mark|summary> ...");
  process.exit(2);
}

import { pool } from "../db/client.js";
import { loadQueries } from "../eval/queries.js";
import { runEval } from "../eval/run.js";
import { summarize, type GroupScore, type Outcome } from "../eval/score.js";
import { search } from "../query/search.js";

const k = process.argv[2] ? Number(process.argv[2]) : 5;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const row = (label: string, g: GroupScore) =>
  `${label.padEnd(18)} ${String(g.questions).padStart(3)}   ${pct(g.hitRateAt1).padStart(6)}   ${pct(g.hitRate).padStart(6)}   ${g.mrr.toFixed(3)}`;
const label = (o: Outcome["results"][number]) =>
  o.alertName ? `alert: ${o.alertName}` : (o.title ?? o.url);
const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;

try {
  const queries = await loadQueries();
  const outcomes = await runEval(
    queries,
    (question, kk) => search(pool, question, { k: kk }),
    k,
  );
  const s = summarize(outcomes, k);

  console.log(`\nEval: ${queries.length} questions, top ${k}\n`);
  console.log(`${"".padEnd(18)} n     hit@1    hit@${k}    MRR`);
  console.log(row("ALL (answerable)", s.overall));
  for (const [c, g] of Object.entries(s.byCategory)) console.log(row(c, g));

  console.log(
    `\nFailures (${s.failures.length}): expected answer not in top ${k}`,
  );
  for (const o of s.failures) {
    console.log(`\n  ${o.query.id}  "${o.query.question}"`);
    console.log(
      `    expected: ${o.query.expected.map((e) => ("runbook" in e ? e.runbook : `alert: ${e.alert}`)).join("  |  ")}`,
    );
    o.results.forEach((r, i) =>
      console.log(
        `    got #${i + 1}: ${label(r).slice(0, 100)}  (${r.distance.toFixed(3)})`,
      ),
    );
  }

  const late = outcomes.filter((o) => o.rank !== null && o.rank > 1);
  console.log(`\nFound, but not first (${late.length}):`);
  for (const o of late) {
    console.log(
      `  ${o.query.id} rank ${o.rank}  "${o.query.question.slice(0, 60)}"  (top result: ${label(o.results[0]!).slice(0, 70)})`,
    );
  }

  const top1 = (os: Outcome[]) => os.map((o) => o.results[0]?.distance ?? NaN);
  const hitsAt1 = outcomes.filter((o) => o.rank === 1);
  console.log(`\nTop-1 distance (for the "not found" threshold in Phase 4):`);
  console.log(
    `  answerable, correct at #1: median ${median(top1(hitsAt1)).toFixed(3)}  (n=${hitsAt1.length})`,
  );
  console.log(
    `  unanswerable:              median ${median(top1(s.unanswerable)).toFixed(3)}  (n=${s.unanswerable.length})`,
  );
  for (const o of s.unanswerable) {
    const r = o.results[0];
    console.log(
      `    ${o.query.id} ${r ? r.distance.toFixed(3) : "-"}  "${o.query.question.slice(0, 50)}" -> ${r ? label(r).slice(0, 60) : "-"}`,
    );
  }
} finally {
  await pool.end();
}

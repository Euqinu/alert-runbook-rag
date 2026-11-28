import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { GenerationRecord } from "../eval/generation.js";
import { JUDGE_MODEL, judgeAnswer, judgeCostUsd } from "../eval/judge.js";
import { runJudge, type JudgedRecord } from "../eval/judgeRun.js";

// Usage: npm run eval:judge -- --from <answers.json>            (judge every answer that has content)
//        npm run eval:judge -- --from <answers.json> q18 q32    (only these question ids)
const args = process.argv.slice(2);
if (args[0] !== "--from" || !args[1])
  throw new Error(
    "Usage: npm run eval:judge -- --from <answers.json> [question ids]",
  );
const answersFile = args[1];
const ids = args.slice(2);

const pct = (x: number | null) =>
  x === null ? "  -  " : `${(x * 100).toFixed(0)}%`.padStart(4);
const mean = (xs: number[]) =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

const saved = JSON.parse(await readFile(answersFile, "utf8")) as {
  records: GenerationRecord[];
};
const records = ids.length
  ? ids.map((id) => {
      const r = saved.records.find((x) => x.query.id === id);
      if (!r) throw new Error(`Question ${id} is not in ${answersFile}`);
      return r;
    })
  : saved.records;

await mkdir("eval/runs", { recursive: true });
const file = `eval/runs/judge-${new Date().toISOString().replaceAll(":", "-")}.json`;
console.log(
  `Judging answers from ${answersFile} with ${JUDGE_MODEL}. Saving to ${file}\n`,
);

const save = (judged: JudgedRecord[]) =>
  writeFile(
    file,
    JSON.stringify(
      {
        judgeModel: JUDGE_MODEL,
        answersFile,
        createdAt: new Date().toISOString(),
        judged,
      },
      null,
      2,
    ),
  );

const { judged, skipped } = await runJudge(
  records,
  (record) => judgeAnswer(record),
  async (r, all) => {
    // Save after every question so a crash keeps what was already paid for.
    await save(all);
    const u = r.call.usage;
    const s = r.score;
    console.log(
      `${r.id.padEnd(4)} ${s ? `claims ${String(s.claims).padStart(2)}  S${s.supported} M${s.miscited} U${s.unsupported} C${s.contradicted}  completeness ${s.completeness}  badQuotes ${s.unverifiedQuotes}  ${s.pass ? "PASS" : "FAIL"}` : `ERROR: ${r.call.error}`}   tokens in ${u.inputTokens} out ${u.outputTokens} (thinking ${u.thinkingTokens ?? "?"})`,
    );
  },
);

const scored = judged.flatMap((j) => (j.score ? [j.score] : []));
const inTok = judged.reduce((a, j) => a + j.call.usage.inputTokens, 0);
const outTok = judged.reduce((a, j) => a + j.call.usage.outputTokens, 0);

console.log(
  `\nJudged ${judged.length}, skipped ${skipped.length} (bare "Not found" replies or refusals), errors ${judged.length - scored.length}`,
);
console.log(`PASS: ${scored.filter((s) => s.pass).length} of ${scored.length}`);
console.log(
  `Mean faithfulness ${pct(mean(scored.flatMap((s) => (s.faithfulness === null ? [] : [s.faithfulness]))))}   mean citation accuracy ${pct(mean(scored.flatMap((s) => (s.citationAccuracy === null ? [] : [s.citationAccuracy]))))}`,
);
console.log(
  `Completeness 3/2/1/0: ${[3, 2, 1, 0].map((c) => scored.filter((s) => s.completeness === c).length).join(" / ")}`,
);
console.log(
  `Claims whose quote was NOT found in the named source: ${scored.reduce((a, s) => a + s.unverifiedQuotes, 0)}`,
);

for (const j of judged) {
  if (!j.score || j.score.pass) continue;
  const rec = records.find((r) => r.query.id === j.id)!;
  console.log(`\n${j.id} did not pass: "${rec.query.question.slice(0, 70)}"`);
  for (const c of j.call.judgement?.claims ?? [])
    if (c.status === "UNSUPPORTED" || c.status === "CONTRADICTED")
      console.log(`  ${c.status}: ${c.text}`);
  for (const o of j.call.judgement?.omissions ?? [])
    if (o.kind !== "minor_step")
      console.log(`  MISSING ${o.kind} (source ${o.source}): ${o.text}`);
}

console.log(
  `\nTokens: ${inTok} in, ${outTok} out. Cost: $${judgeCostUsd(inTok, outTok).toFixed(3)} (Opus 5.5 prices)`,
);
console.log(`Judgements saved to ${file}`);

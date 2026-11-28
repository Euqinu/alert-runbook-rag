import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extractCitations } from "../query/answer.js";
import type { GenerationRecord } from "../eval/generation.js";
import {
  JUDGE_MODEL,
  judgeAnswer,
  judgeCostUsd,
  rulesFor,
  scoreJudgement,
} from "../eval/judge.js";
import { PLANTS } from "../eval/plant.js";

// Usage: npm run eval:plant -- --from <answers.json>
// Plants known errors into the saved answer for q18 (the plants are written for that exact text)
// and checks that the judge catches each one.
const args = process.argv.slice(2);
if (args[0] !== "--from" || !args[1])
  throw new Error("Usage: npm run eval:plant -- --from <answers.json>");
const answersFile = args[1];

const saved = JSON.parse(await readFile(answersFile, "utf8")) as {
  records: GenerationRecord[];
};
const base = saved.records.find((r) => r.query.id === "q18");
if (!base) throw new Error(`q18 is not in ${answersFile}`);

// Build every planted record BEFORE any API call, so a broken plant costs nothing.
const planted = PLANTS.map((plant) => {
  const text = plant.apply(base.answer.text);
  if (plant.name !== "control" && text === base.answer.text)
    throw new Error(`plant ${plant.name} did not change the answer`);
  if (
    plant.mustBeAbsentFromSources &&
    base.results.some((r) => r.text.includes(plant.mustBeAbsentFromSources!))
  )
    throw new Error(
      `plant ${plant.name} is not invented: a source contains "${plant.mustBeAbsentFromSources}"`,
    );
  // Recompute the citation facts from the new text, exactly as the real writer does.
  const { valid, invalid } = extractCitations(text, base.results.length);
  const record: GenerationRecord = {
    ...base,
    answer: {
      ...base.answer,
      text,
      citations: valid,
      invalidCitations: invalid,
    },
  };
  return { plant, record };
});

await mkdir("eval/runs", { recursive: true });
const file = `eval/runs/plant-${new Date().toISOString().replaceAll(":", "-")}.json`;
console.log(
  `Planting errors into q18 ("${base.query.question}") and judging with ${JUDGE_MODEL}.\n`,
);

const results = [];
let inTok = 0;
let outTok = 0;
for (const { plant, record } of planted) {
  const call = await judgeAnswer(record);
  inTok += call.usage.inputTokens;
  outTok += call.usage.outputTokens;
  const score = call.judgement
    ? scoreJudgement(call.judgement, rulesFor(record), record.results)
    : null;
  const caught =
    call.judgement && score ? plant.caught(call.judgement, score) : false;
  results.push({
    plant: plant.name,
    change: plant.change,
    expected: plant.expected,
    caught,
    score,
    call,
    answerText: record.answer.text,
  });
  console.log(`${plant.name}`);
  console.log(`  change:   ${plant.change}`);
  console.log(`  expected: ${plant.expected}`);
  if (!score || !call.judgement) {
    console.log(`  ERROR:    ${call.error}\n`);
    continue;
  }
  console.log(
    `  judge:    S${score.supported} M${score.miscited} U${score.unsupported} C${score.contradicted}  completeness ${score.completeness}  badQuotes ${score.unverifiedQuotes}  ${score.pass ? "PASS" : "FAIL"}`,
  );
  for (const c of call.judgement.claims)
    if (c.status !== "SUPPORTED") console.log(`    ${c.status}: ${c.text}`);
  for (const o of call.judgement.omissions)
    console.log(`    MISSING ${o.kind} (source ${o.source}): ${o.text}`);
  console.log(`  RESULT:   ${caught ? "as expected" : "NOT AS EXPECTED"}\n`);
}

await writeFile(
  file,
  JSON.stringify(
    {
      judgeModel: JUDGE_MODEL,
      answersFile,
      createdAt: new Date().toISOString(),
      results,
    },
    null,
    2,
  ),
);

console.log(
  `As expected: ${results.filter((r) => r.caught).length} of ${results.length}`,
);
console.log(
  `Tokens: ${inTok} in, ${outTok} out. Cost: $${judgeCostUsd(inTok, outTok).toFixed(3)} (Opus 5.5 prices)`,
);
console.log(`Saved to ${file}`);

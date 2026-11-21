import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pool } from "../db/client.js";
import {
  RULE_NAMES,
  checkRules,
  summarizeRules,
  type GenerationRecord,
} from "../eval/generation.js";
import { runGeneration } from "../eval/generationRun.js";
import { loadQueries } from "../eval/queries.js";
import { GENERATION_MODEL, generateAnswer } from "../query/answer.js";
import { search } from "../query/search.js";

// Usage: npm run eval:gen                       (write answers for all questions)
//        npm run eval:gen -- q18 q41            (only these question ids)
//        npm run eval:gen -- --from <file.json> (re-apply the rules to a SAVED run: no API calls, free)
const args = process.argv.slice(2);
const k = 5;

/** Print the rule table, the failures and the cost for a set of saved or fresh records. */
function report(records: GenerationRecord[]): void {
  const s = summarizeRules(records);
  console.log(`\nRules on ${s.questions} questions (pass / fail / n/a):`);
  for (const rule of RULE_NAMES) {
    const c = s.counts[rule];
    console.log(
      `  ${rule.padEnd(20)} ${String(c.pass).padStart(3)} / ${String(c.fail).padStart(3)} / ${String(c["n/a"]).padStart(3)}`,
    );
  }
  if (s.meanCitationCoverage !== null)
    console.log(
      `  (info) mean share of answer lines with a citation: ${(s.meanCitationCoverage * 100).toFixed(1)}%`,
    );

  console.log(`\nFailures (${s.failures.length}):`);
  for (const f of s.failures)
    console.log(`  ${f.id}  ${f.rule}  "${f.question.slice(0, 70)}"`);

  console.log(
    `\nTokens: ${s.inputTokens} in, ${s.outputTokens} out. Estimated cost: $${s.costUsd.toFixed(3)} (Sonnet 5.5 prices)`,
  );
}

try {
  if (args[0] === "--from") {
    const path = args[1];
    if (!path) throw new Error("Usage: npm run eval:gen -- --from <file.json>");
    const saved = JSON.parse(await readFile(path, "utf8")) as {
      records: GenerationRecord[];
    };
    console.log(
      `Re-scoring ${saved.records.length} saved answers from ${path}`,
    );
    report(saved.records);
  } else {
    const all = await loadQueries();
    const queries = args.length
      ? args.map((id) => {
          const q = all.find((x) => x.id === id);
          if (!q) throw new Error(`Unknown question id: ${id}`);
          return q;
        })
      : all;

    await mkdir("eval/runs", { recursive: true });
    const file = `eval/runs/gen-${new Date().toISOString().replaceAll(":", "-")}.json`;
    console.log(
      `Writing answers for ${queries.length} questions with ${GENERATION_MODEL}. Saving to ${file}\n`,
    );

    const records = await runGeneration(
      queries,
      (question, kk) => search(pool, question, { k: kk }),
      (question, results) => generateAnswer(question, results),
      k,
      async (record, soFar) => {
        // Rewrite the whole file after every question: a crash keeps everything paid for so far.
        await writeFile(
          file,
          JSON.stringify(
            {
              model: GENERATION_MODEL,
              k,
              createdAt: new Date().toISOString(),
              records: soFar,
            },
            null,
            2,
          ),
        );
        const a = record.answer;
        const flags = RULE_NAMES.filter(
          (r) => checkRules(record)[r] === "fail",
        );
        console.log(
          `${record.query.id.padEnd(4)} in ${String(a.usage.inputTokens).padStart(5)} out ${String(a.usage.outputTokens).padStart(5)}  ${a.notFound ? "NOT-FOUND" : a.refused ? "REFUSED  " : "answered "} ${flags.length ? `FAIL: ${flags.join(", ")}` : ""}`,
        );
      },
    );

    report(records);
    console.log(`Answers saved to ${file}`);
  }
} finally {
  await pool.end();
}

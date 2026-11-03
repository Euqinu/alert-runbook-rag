import { pool } from "../db/client.js";
import { generateAnswer } from "../query/answer.js";
import { search } from "../query/search.js";

const [question, kArg] = process.argv.slice(2);
if (!question) {
  console.error('Usage: npm run ask -- "your question" [k]');
  process.exit(1);
}

try {
  const results = await search(pool, question, {
    k: kArg ? Number(kArg) : 5,
  });
  const answer = await generateAnswer(question, results);

  console.log(`\nQuestion: ${question}\n`);
  if (answer.refused)
    console.log("(The request was declined by safety classifiers.)");
  else console.log(answer.text);

  if (answer.citations.length > 0) {
    console.log("\nSources:");
    for (const n of answer.citations) {
      const r = results[n - 1]!;
      console.log(`  [${n}] ${r.title ?? r.alertName}`);
      console.log(`      ${r.url}  (${r.license})`);
    }
  }
  if (answer.invalidCitations.length > 0)
    console.log(
      `\nWARNING: cites non-existent sources: ${answer.invalidCitations.join(", ")}`,
    );
  if (answer.truncated)
    console.log("\nWARNING: answer was cut off (max_tokens).");

  console.log(
    `\n[model ${answer.model} | tokens in ${answer.usage.inputTokens}, out ${answer.usage.outputTokens} | notFound=${answer.notFound} | top-1 distance ${results[0]?.distance.toFixed(3) ?? "-"}]`,
  );
} finally {
  await pool.end();
}

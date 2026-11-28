import { pool } from "../db/client.js";
import { hybridSearch } from "../query/hybrid.js";
import { search, searchFullText } from "../query/search.js";

const [question, kArg, mode] = process.argv.slice(2);
if (!question) {
  console.error(
    'Usage: npm run search -- "your question" [k] [vector|text|hybrid]',
  );
  process.exit(1);
}

try {
  const k = kArg ? Number(kArg) : 5;
  // "text" = keyword search only, "hybrid" = both fused with RRF; anything else = the vector baseline.
  const label =
    mode === "text" ? "full-text" : mode === "hybrid" ? "hybrid" : "vector";
  const results =
    mode === "text"
      ? (await searchFullText(pool, question, { k })).map((r) => ({
          ...r,
          score: `rank ${r.rank.toFixed(4)}`,
        }))
      : mode === "hybrid"
        ? (await hybridSearch(pool, question, { k })).map((r) => ({
            ...r,
            score: `rrf ${r.score.toFixed(4)} (vector #${r.vectorRank ?? "-"}, text #${r.textRank ?? "-"})`,
          }))
        : (await search(pool, question, { k })).map((r) => ({
            ...r,
            score: `distance ${r.distance.toFixed(4)}`,
          }));
  console.log(`Top ${results.length} (${label}) for: ${question}\n`);
  for (const [i, r] of results.entries()) {
    const snippet = r.text.replace(/\s+/g, " ").slice(0, 220);
    console.log(`#${i + 1}  ${r.score}  [${r.source}]`);
    console.log(`    ${r.title ?? "(no title)"}  (chunk ${r.chunkIndex})`);
    console.log(`    ${snippet}`);
    console.log(`    ${r.url}\n`);
  }
} finally {
  await pool.end();
}

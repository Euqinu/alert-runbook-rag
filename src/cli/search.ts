import { pool } from "../db/client.js";
import { search } from "../query/search.js";

const [question, kArg] = process.argv.slice(2);
if (!question) {
  console.error('Usage: npm run search -- "your question" [k]');
  process.exit(1);
}

try {
  const results = await search(pool, question, { k: kArg ? Number(kArg) : 5 });
  console.log(`Top ${results.length} for: ${question}\n`);
  for (const [i, r] of results.entries()) {
    const snippet = r.text.replace(/\s+/g, " ").slice(0, 220);
    console.log(`#${i + 1}  distance ${r.distance.toFixed(4)}  [${r.source}]`);
    console.log(`    ${r.title ?? "(no title)"}  (chunk ${r.chunkIndex})`);
    console.log(`    ${snippet}`);
    console.log(`    ${r.url}\n`);
  }
} finally {
  await pool.end();
}

import { pool } from "../db/client.js";
import { loadAllDocuments } from "../ingestion/documents.js";
import { ingest } from "../ingestion/ingest.js";

const documents = await loadAllDocuments();
console.log(`Loaded ${documents.length} documents from data/`);

let processed = 0;
try {
  const summary = await ingest(pool, documents, {
    onDocument: (doc, reason) => {
      processed++;
      if (processed === 1 || processed % 10 === 0) {
        console.log(
          `  #${processed} (${reason}) ${doc.url.split("/").pop()} - ${doc.chunks.length} chunks`,
        );
      }
    },
  });
  console.log("Done:", summary);
} finally {
  await pool.end();
}

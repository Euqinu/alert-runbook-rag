import type pg from "pg";
import type { SourceDocument } from "./documents.js";

/** pgvector reads a vector from text like "[0.1,0.2,0.3]"; the SQL casts it with ::vector. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * Replace everything stored for one document, atomically: delete its old rows, insert the new ones.
 * Either all of it happens or none of it. A crash halfway must never leave a url with only some
 * chunks, because every row carries the new doc_hash and the skip check would then trust it forever.
 *
 * `embeddings[i]` belongs to `doc.chunks[i]`. Embed BEFORE calling this: a transaction should not
 * stay open while we wait on a network call.
 */
export async function replaceDocument(
  db: pg.Pool,
  doc: SourceDocument,
  embeddings: number[][],
): Promise<void> {
  if (embeddings.length !== doc.chunks.length) {
    throw new Error(
      `${doc.url}: ${doc.chunks.length} chunks but ${embeddings.length} embeddings`,
    );
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM chunks WHERE url = $1", [doc.url]);
    for (const [i, chunk] of doc.chunks.entries()) {
      await client.query(
        `INSERT INTO chunks
           (text, embedding, source, title, alert_name, url, license, doc_hash, chunk_index)
         VALUES ($1, $2::vector, $3, $4, $5, $6, $7, $8, $9)`,
        [
          chunk.text,
          toVectorLiteral(embeddings[i]!),
          doc.source,
          chunk.title,
          chunk.alertName,
          doc.url,
          doc.license,
          doc.docHash,
          chunk.chunkIndex,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

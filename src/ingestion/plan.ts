import type pg from "pg";
import type { SourceDocument } from "./documents.js";

export interface IngestionPlan {
  /** Documents that must be (re)built: never stored before, or stored with a different hash. */
  toProcess: { doc: SourceDocument; reason: "new" | "changed" }[];
  /** Documents whose stored hash equals the current one: nothing to do. */
  unchanged: SourceDocument[];
}

/** url -> doc_hash as currently stored in the chunks table. */
export async function fetchStoredHashes(
  db: pg.Pool,
): Promise<Map<string, string>> {
  const { rows } = await db.query<{ url: string; doc_hash: string }>(
    "SELECT DISTINCT url, doc_hash FROM chunks",
  );
  return new Map(rows.map((r) => [r.url, r.doc_hash]));
}

/** Pure decision: compare each document's current hash with what the database has. */
export function planIngestion(
  documents: SourceDocument[],
  storedHashes: Map<string, string>,
): IngestionPlan {
  const plan: IngestionPlan = { toProcess: [], unchanged: [] };
  for (const doc of documents) {
    const stored = storedHashes.get(doc.url);
    if (stored === undefined) plan.toProcess.push({ doc, reason: "new" });
    else if (stored !== doc.docHash)
      plan.toProcess.push({ doc, reason: "changed" });
    else plan.unchanged.push(doc);
  }
  return plan;
}

import type pg from "pg";
import type { SourceDocument } from "./documents.js";
import { embedTexts, type EmbedOptions, type EmbedResult } from "./embed.js";
import { fetchStoredHashes, planIngestion } from "./plan.js";
import { replaceDocument } from "./store.js";

export interface IngestSummary {
  newDocs: number;
  changedDocs: number;
  unchangedDocs: number;
  chunksWritten: number;
  tokensUsed: number;
}

type EmbedFn = (texts: string[], options: EmbedOptions) => Promise<EmbedResult>;

/** Skip check, then for each document that needs it: embed, then write in one transaction. */
export async function ingest(
  db: pg.Pool,
  documents: SourceDocument[],
  options: {
    embed?: EmbedFn;
    onDocument?: (doc: SourceDocument, reason: "new" | "changed") => void;
  } = {},
): Promise<IngestSummary> {
  const embed = options.embed ?? embedTexts;
  const plan = planIngestion(documents, await fetchStoredHashes(db));

  const summary: IngestSummary = {
    newDocs: 0,
    changedDocs: 0,
    unchangedDocs: plan.unchanged.length,
    chunksWritten: 0,
    tokensUsed: 0,
  };

  // One document at a time: if the run dies, finished documents are safely stored
  // and the next run's skip check picks up where this one stopped.
  for (const { doc, reason } of plan.toProcess) {
    options.onDocument?.(doc, reason);
    const { embeddings, totalTokens } = await embed(
      doc.chunks.map((c) => c.text),
      { inputType: "document" },
    );
    await replaceDocument(db, doc, embeddings);

    if (reason === "new") summary.newDocs++;
    else summary.changedDocs++;
    summary.chunksWritten += doc.chunks.length;
    summary.tokensUsed += totalTokens;
  }
  return summary;
}

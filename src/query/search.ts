import type pg from "pg";
import {
  embedTexts,
  type EmbedOptions,
  type EmbedResult,
} from "../ingestion/embed.js";
import { toVectorLiteral } from "../ingestion/store.js";

export interface SearchResult {
  text: string;
  title: string | null;
  alertName: string | null;
  source: string;
  url: string;
  license: string;
  chunkIndex: number;
  /** Cosine distance to the question: 0 = same direction, larger = less similar. */
  distance: number;
}

type EmbedFn = (texts: string[], options: EmbedOptions) => Promise<EmbedResult>;

/** Baseline retrieval: embed the question, return the K chunks with the smallest cosine distance. */
export async function search(
  db: pg.Pool,
  question: string,
  options: { k?: number; embed?: EmbedFn } = {},
): Promise<SearchResult[]> {
  const k = options.k ?? 5;
  const embed = options.embed ?? embedTexts;

  // "query", not "document": the question is what we search FOR (queries use a different input type from stored chunks).
  const { embeddings } = await embed([question], { inputType: "query" });
  const queryVector = toVectorLiteral(embeddings[0]!);

  // <=> is pgvector's cosine distance. ORDER BY it ascending = most similar first.
  const { rows } = await db.query<{
    text: string;
    title: string | null;
    alert_name: string | null;
    source: string;
    url: string;
    license: string;
    chunk_index: number;
    distance: number;
  }>(
    `SELECT text, title, alert_name, source, url, license, chunk_index,
            embedding <=> $1::vector AS distance
       FROM chunks
      ORDER BY embedding <=> $1::vector
      LIMIT $2`,
    [queryVector, k],
  );

  return rows.map((r) => ({
    text: r.text,
    title: r.title,
    alertName: r.alert_name,
    source: r.source,
    url: r.url,
    license: r.license,
    chunkIndex: r.chunk_index,
    distance: r.distance,
  }));
}

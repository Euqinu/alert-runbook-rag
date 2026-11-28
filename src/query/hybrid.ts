import type pg from "pg";
import { fuseRRF } from "./fusion.js";
import {
  search,
  searchFullText,
  type FullTextResult,
  type SearchResult,
} from "./search.js";

export interface HybridResult extends Omit<SearchResult, "distance"> {
  /** RRF score: only meaningful for ordering within one query. */
  score: number;
  /** Cosine distance if the vector search returned this chunk, else null. */
  distance: number | null;
  /** 1-based position in the vector list / the full-text list; null = that searcher did not return it. */
  vectorRank: number | null;
  textRank: number | null;
}

type VectorOptions = Parameters<typeof search>[2];

/**
 * Hybrid retrieval: run vector search and full-text search, merge the two rankings with RRF.
 *
 * Each searcher returns `depth` candidates (default 20), and only the fused top `k` are kept.
 * Fusing a wider pool than we return matters: with only the top 5 of each, a chunk the keyword
 * search ranked 6th (often a tie broken by row id) could never reach the fusion.
 */
export async function hybridSearch(
  db: pg.Pool,
  question: string,
  options: {
    k?: number;
    depth?: number;
    embed?: NonNullable<VectorOptions>["embed"];
  } = {},
): Promise<HybridResult[]> {
  const k = options.k ?? 5;
  const depth = Math.max(options.depth ?? 20, k);

  const [vectorList, textList] = await Promise.all([
    search(db, question, { k: depth, embed: options.embed }),
    searchFullText(db, question, { k: depth }),
  ]);

  // (url, chunk_index) is UNIQUE in the table, so it identifies a chunk in both lists.
  const key = (c: SearchResult | FullTextResult) => `${c.url}#${c.chunkIndex}`;

  // Vector list goes first: on equal RRF scores, the better vector position wins the tie.
  const fused = fuseRRF<SearchResult | FullTextResult>(
    [vectorList, textList],
    key,
    { limit: k },
  );

  // The first list that returned a chunk supplies its fields (they are identical in both lists).
  // Only a vector result carries a distance, so a chunk found by keywords alone gets null.
  return fused.map(({ item, score, ranks }) => ({
    text: item.text,
    title: item.title,
    alertName: item.alertName,
    source: item.source,
    url: item.url,
    license: item.license,
    chunkIndex: item.chunkIndex,
    distance: "distance" in item ? item.distance : null,
    score,
    vectorRank: ranks[0] ?? null,
    textRank: ranks[1] ?? null,
  }));
}

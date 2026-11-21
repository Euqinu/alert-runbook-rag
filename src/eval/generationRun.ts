import type { Answer } from "../query/answer.js";
import type { SearchResult } from "../query/search.js";
import type { GenerationRecord } from "./generation.js";
import type { EvalQuery } from "./queries.js";
import { firstHitRank } from "./score.js";

type SearchFn = (question: string, k: number) => Promise<SearchResult[]>;
type GenerateFn = (
  question: string,
  results: SearchResult[],
) => Promise<Answer>;

/**
 * For each question: search, then write an answer from the retrieved chunks.
 * One at a time on purpose (simple, and easy on rate limits). `onRecord` is called after every
 * question so the caller can save progress: if the run dies at question 50, the 49 answers
 * already paid for are not lost.
 */
export async function runGeneration(
  queries: EvalQuery[],
  search: SearchFn,
  generate: GenerateFn,
  k: number,
  onRecord?: (
    record: GenerationRecord,
    all: GenerationRecord[],
  ) => Promise<void>,
): Promise<GenerationRecord[]> {
  const records: GenerationRecord[] = [];
  for (const query of queries) {
    const results = await search(query.question, k);
    const answer = await generate(query.question, results);
    const record: GenerationRecord = {
      query,
      retrievalRank: query.answerable
        ? firstHitRank(results, query.expected)
        : null,
      results,
      answer,
    };
    records.push(record);
    await onRecord?.(record, records);
  }
  return records;
}

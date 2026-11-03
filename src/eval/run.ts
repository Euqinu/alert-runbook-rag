import type { SearchResult } from "../query/search.js";
import type { EvalQuery } from "./queries.js";
import { firstHitRank, type Outcome } from "./score.js";

type SearchFn = (question: string, k: number) => Promise<SearchResult[]>;

/** Run every question through the search, one at a time, and record where the answer landed. */
export async function runEval(
  queries: EvalQuery[],
  search: SearchFn,
  k: number,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const query of queries) {
    const results = await search(query.question, k);
    outcomes.push({
      query,
      results,
      rank: query.answerable ? firstHitRank(results, query.expected) : null,
    });
  }
  return outcomes;
}

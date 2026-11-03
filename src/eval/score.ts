import type { SearchResult } from "../query/search.js";
import type { EvalQuery, Expected } from "./queries.js";

/** Does this result satisfy one expected entry? */
export function matches(result: SearchResult, expected: Expected): boolean {
  if ("runbook" in expected) {
    // Runbook chunk titles look like "patroni/postgres.md > Heading > Subheading".
    return (
      result.source === "gitlab-runbooks" &&
      result.title !== null &&
      (result.title === expected.runbook ||
        result.title.startsWith(`${expected.runbook} > `))
    );
  }
  return (
    result.source === "awesome-prometheus-alerts" &&
    result.alertName === expected.alert
  );
}

/** 1-based position of the first result matching ANY expected entry, or null if none does. */
export function firstHitRank(
  results: SearchResult[],
  expected: Expected[],
): number | null {
  const index = results.findIndex((r) => expected.some((e) => matches(r, e)));
  return index === -1 ? null : index + 1;
}

export interface Outcome {
  query: EvalQuery;
  results: SearchResult[];
  /** null = no expected answer in the results (always null for unanswerable questions). */
  rank: number | null;
}

export interface GroupScore {
  questions: number;
  hitRate: number;
  hitRateAt1: number;
  mrr: number;
}

export interface Summary {
  k: number;
  overall: GroupScore;
  byCategory: Record<string, GroupScore>;
  /** Answerable questions where no expected answer appeared in the top K. */
  failures: Outcome[];
  /** Unanswerable questions: reported separately, they have nothing to hit. */
  unanswerable: Outcome[];
}

function scoreGroup(outcomes: Outcome[]): GroupScore {
  const n = outcomes.length;
  const sum = (f: (o: Outcome) => number) =>
    outcomes.reduce((acc, o) => acc + f(o), 0);
  return {
    questions: n,
    hitRate: n === 0 ? 0 : sum((o) => (o.rank !== null ? 1 : 0)) / n,
    hitRateAt1: n === 0 ? 0 : sum((o) => (o.rank === 1 ? 1 : 0)) / n,
    // A miss counts as 0, a hit at rank r counts as 1/r.
    mrr: n === 0 ? 0 : sum((o) => (o.rank !== null ? 1 / o.rank : 0)) / n,
  };
}

export function summarize(outcomes: Outcome[], k: number): Summary {
  const answerable = outcomes.filter((o) => o.query.answerable);
  const categories = [...new Set(answerable.map((o) => o.query.category))];
  return {
    k,
    overall: scoreGroup(answerable),
    byCategory: Object.fromEntries(
      categories.map((c) => [
        c,
        scoreGroup(answerable.filter((o) => o.query.category === c)),
      ]),
    ),
    failures: answerable.filter((o) => o.rank === null),
    unanswerable: outcomes.filter((o) => !o.query.answerable),
  };
}

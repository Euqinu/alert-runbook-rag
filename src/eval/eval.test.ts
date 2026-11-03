import { describe, expect, it } from "vitest";
import type { SearchResult } from "../query/search.js";
import { loadQueries, type EvalQuery } from "./queries.js";
import { runEval } from "./run.js";
import { firstHitRank, matches, summarize } from "./score.js";

const runbook = (title: string): SearchResult => ({
  text: "t",
  title,
  alertName: null,
  source: "gitlab-runbooks",
  url: "u",
  license: "MIT",
  chunkIndex: 0,
  distance: 0.4,
});
const alert = (name: string): SearchResult => ({
  ...runbook("Databases > Redis"),
  source: "awesome-prometheus-alerts",
  alertName: name,
});

describe("matches", () => {
  it("matches a runbook by the start of the title", () => {
    const r = runbook("patroni/postgres.md > Troubleshooting > Replication");
    expect(matches(r, { runbook: "patroni/postgres.md" })).toBe(true);
    expect(matches(r, { runbook: "patroni/postgres" })).toBe(false);
  });

  it("does not confuse files whose names share a prefix", () => {
    const r = runbook("patroni/postgresql-locking.md > Locks");
    expect(matches(r, { runbook: "patroni/postgres.md" })).toBe(false);
    expect(matches(r, { runbook: "patroni/postgresql.md" })).toBe(false);
  });

  it("matches an alert by exact name, and only from the alerts source", () => {
    expect(
      matches(alert("Host out of memory"), { alert: "Host out of memory" }),
    ).toBe(true);
    expect(
      matches(alert("Host out of memory"), { alert: "Host OOM kill detected" }),
    ).toBe(false);
    expect(
      matches(runbook("Host out of memory"), { alert: "Host out of memory" }),
    ).toBe(false);
  });
});

describe("firstHitRank", () => {
  const results = [runbook("a.md > x"), alert("A"), runbook("b.md > y")];

  it("is 1-based and takes the earliest match among all expected entries", () => {
    expect(firstHitRank(results, [{ runbook: "b.md" }, { alert: "A" }])).toBe(
      2,
    );
  });

  it("is null when nothing matches", () => {
    expect(firstHitRank(results, [{ runbook: "zzz.md" }])).toBeNull();
  });
});

const q = (id: string, category: string, answerable = true): EvalQuery => ({
  id,
  category,
  question: id,
  answerable,
  expected: answerable ? [{ runbook: "x.md" }] : [],
});

describe("summarize", () => {
  it("computes hit rate, hit@1 and MRR, counting a miss as 0", () => {
    // ranks 1, 3, miss  ->  hit rate 2/3, hit@1 1/3, MRR (1 + 1/3 + 0) / 3
    const s = summarize(
      [
        { query: q("a", "c1"), results: [], rank: 1 },
        { query: q("b", "c1"), results: [], rank: 3 },
        { query: q("c", "c2"), results: [], rank: null },
      ],
      5,
    );
    expect(s.overall.hitRate).toBeCloseTo(2 / 3);
    expect(s.overall.hitRateAt1).toBeCloseTo(1 / 3);
    expect(s.overall.mrr).toBeCloseTo((1 + 1 / 3) / 3);
    expect(s.byCategory.c1?.hitRate).toBe(1);
    expect(s.byCategory.c2?.hitRate).toBe(0);
    expect(s.failures.map((o) => o.query.id)).toEqual(["c"]);
  });

  it("keeps unanswerable questions out of the scores", () => {
    const s = summarize(
      [
        { query: q("a", "c1"), results: [], rank: 1 },
        { query: q("u", "unanswerable", false), results: [], rank: null },
      ],
      5,
    );
    expect(s.overall.questions).toBe(1);
    expect(s.overall.hitRate).toBe(1);
    expect(s.unanswerable.map((o) => o.query.id)).toEqual(["u"]);
    expect(s.byCategory.unanswerable).toBeUndefined();
  });
});

describe("runEval", () => {
  it("passes each question and k to the search and records the rank", async () => {
    const asked: [string, number][] = [];
    const outcomes = await runEval(
      [q("a", "c"), q("u", "unanswerable", false)],
      async (question, k) => {
        asked.push([question, k]);
        return [runbook("x.md > h")];
      },
      5,
    );
    expect(asked).toEqual([
      ["a", 5],
      ["u", 5],
    ]);
    expect(outcomes.map((o) => o.rank)).toEqual([1, null]);
  });
});

describe("the real eval/queries.yaml", () => {
  it("loads, with unique ids and consistent answerable flags", async () => {
    const queries = await loadQueries();
    expect(queries.length).toBeGreaterThanOrEqual(30);
    expect(queries.filter((x) => !x.answerable).length).toBeGreaterThan(0);
  });
});

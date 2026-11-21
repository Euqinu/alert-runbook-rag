import { describe, expect, it } from "vitest";
import type { Answer } from "../query/answer.js";
import type { SearchResult } from "../query/search.js";
import {
  answerCostUsd,
  checkRules,
  citationCoverage,
  summarizeRules,
  type GenerationRecord,
} from "./generation.js";
import { runGeneration } from "./generationRun.js";
import type { EvalQuery } from "./queries.js";

const chunk = (title: string): SearchResult => ({
  text: "t",
  title,
  alertName: null,
  source: "gitlab-runbooks",
  url: "u",
  license: "MIT",
  chunkIndex: 0,
  distance: 0.4,
});
const alertChunk = (name: string): SearchResult => ({
  ...chunk("Databases > MySQL"),
  source: "awesome-prometheus-alerts",
  alertName: name,
});

const answer = (over: Partial<Answer> = {}): Answer => ({
  text: "1. Do a thing. [1]",
  notFound: false,
  refused: false,
  truncated: false,
  citations: [1],
  invalidCitations: [],
  model: "m",
  usage: { inputTokens: 2000, outputTokens: 500 },
  ...over,
});
const notFound = (): Answer => answer({ notFound: true, citations: [] });

// The expected runbook is kube/x.md; `foundRunbook` is a retrieved chunk that matches it.
const answerable: EvalQuery = {
  id: "q1",
  category: "symptom",
  question: "pods stuck",
  answerable: true,
  expected: [{ runbook: "kube/x.md" }],
};
const alertOnly: EvalQuery = {
  id: "q3",
  category: "alert-only",
  question: "mysql replica lag",
  answerable: true,
  expected: [{ alert: "MySQL Slave replication lag" }],
};
const unanswerable: EvalQuery = {
  id: "q2",
  category: "unanswerable",
  question: "openshift 503",
  answerable: false,
  expected: [],
};
const foundRunbook = chunk("kube/x.md > Heading");
const otherRunbook = chunk("kube/other.md > Heading");

const record = (
  query: EvalQuery,
  a: Answer,
  results: SearchResult[],
): GenerationRecord => ({
  query,
  answer: a,
  retrievalRank: results.length > 0 ? 1 : null,
  results,
});

describe("checkRules", () => {
  it("passes a normal cited answer", () => {
    const r = checkRules(record(answerable, answer(), [foundRunbook]));
    expect(r).toEqual({
      notTruncated: "pass",
      notRefused: "pass",
      citationsExist: "pass",
      noWrongRefusal: "pass",
      unanswerableHandled: "n/a",
      answerIsCited: "pass",
    });
  });

  it("fails a truncated answer", () => {
    expect(
      checkRules(
        record(answerable, answer({ truncated: true }), [foundRunbook]),
      ).notTruncated,
    ).toBe("fail");
  });

  it("fails a refused answer, and does not grade citations on it", () => {
    const r = checkRules(
      record(answerable, answer({ refused: true, text: "", citations: [] }), [
        foundRunbook,
      ]),
    );
    expect(r.notRefused).toBe("fail");
    expect(r.answerIsCited).toBe("n/a");
  });

  it("fails a citation that points at no source", () => {
    expect(
      checkRules(
        record(answerable, answer({ invalidCitations: [7] }), [foundRunbook]),
      ).citationsExist,
    ).toBe("fail");
  });

  it("fails 'not found' when retrieval DID bring an expected runbook", () => {
    const r = checkRules(
      record(answerable, notFound(), [otherRunbook, foundRunbook]),
    );
    expect(r.noWrongRefusal).toBe("fail");
  });

  it("does not fail 'not found' when retrieval missed the expected runbook (like q32)", () => {
    const r = checkRules(record(answerable, notFound(), [otherRunbook]));
    expect(r.noWrongRefusal).toBe("n/a");
  });

  it("does not fail 'not found' when the only hit is an alert description, not a runbook (D16)", () => {
    const r = checkRules(
      record(alertOnly, notFound(), [
        alertChunk("MySQL Slave replication lag"),
      ]),
    );
    expect(r.noWrongRefusal).toBe("n/a");
  });

  it("still applies when a question accepts both and the RUNBOOK was retrieved (like q39)", () => {
    const both: EvalQuery = {
      ...answerable,
      expected: [
        { alert: "Elasticsearch Cluster Red" },
        { runbook: "kube/x.md" },
      ],
    };
    expect(
      checkRules(
        record(both, notFound(), [
          alertChunk("Elasticsearch Cluster Red"),
          foundRunbook,
        ]),
      ).noWrongRefusal,
    ).toBe("fail");
    // Only the alert came back: the rule does not apply.
    expect(
      checkRules(
        record(both, notFound(), [alertChunk("Elasticsearch Cluster Red")]),
      ).noWrongRefusal,
    ).toBe("n/a");
  });

  it("requires the not-found sentence on an unanswerable question", () => {
    expect(
      checkRules(record(unanswerable, notFound(), [otherRunbook]))
        .unanswerableHandled,
    ).toBe("pass");
    expect(
      checkRules(record(unanswerable, answer(), [otherRunbook]))
        .unanswerableHandled,
    ).toBe("fail");
  });

  it("fails an answerable answer that has no citation at all", () => {
    expect(
      checkRules(record(answerable, answer({ citations: [] }), [foundRunbook]))
        .answerIsCited,
    ).toBe("fail");
  });

  it("does not ask a not-found reply to carry citations", () => {
    expect(
      checkRules(record(answerable, notFound(), [otherRunbook])).answerIsCited,
    ).toBe("n/a");
  });
});

describe("citationCoverage", () => {
  it("is the share of non-empty lines that contain a [n]", () => {
    expect(citationCoverage("1. a [1]\n2. b\n\n3. c [2][3]\n4. d")).toBe(0.5);
  });

  it("is null for empty text", () => {
    expect(citationCoverage("  \n ")).toBeNull();
  });
});

describe("answerCostUsd", () => {
  it("matches the worked example (2,338 in + 757 out is about 1.2 cents)", () => {
    expect(answerCostUsd(2338, 757)).toBeCloseTo(0.01225, 4);
  });
});

describe("summarizeRules", () => {
  it("counts passes and failures, lists failures, and adds up tokens", () => {
    const s = summarizeRules([
      record(answerable, answer(), [foundRunbook]),
      record(answerable, answer({ truncated: true }), [foundRunbook]),
      record(unanswerable, notFound(), []),
    ]);
    expect(s.questions).toBe(3);
    expect(s.counts.notTruncated).toEqual({ pass: 2, fail: 1, "n/a": 0 });
    expect(s.counts.unanswerableHandled).toEqual({
      pass: 1,
      fail: 0,
      "n/a": 2,
    });
    expect(s.failures).toEqual([
      { id: "q1", question: "pods stuck", rule: "notTruncated" },
    ]);
    expect(s.inputTokens).toBe(6000);
    expect(s.outputTokens).toBe(1500);
    expect(s.meanCitationCoverage).toBe(1);
  });
});

describe("runGeneration", () => {
  it("searches, answers each question in order, records retrieval rank, and reports progress", async () => {
    const seen: string[] = [];
    const saved: number[] = [];
    const records = await runGeneration(
      [answerable, unanswerable],
      async () => [chunk("kube/x.md > Heading")],
      async (question, results) => {
        seen.push(question);
        expect(results).toHaveLength(1);
        return answer();
      },
      5,
      async (_record, all) => {
        saved.push(all.length);
      },
    );
    expect(seen).toEqual(["pods stuck", "openshift 503"]);
    expect(saved).toEqual([1, 2]);
    expect(records[0]!.retrievalRank).toBe(1);
    // An unanswerable question has nothing to hit, so its rank is always null.
    expect(records[1]!.retrievalRank).toBeNull();
    expect(records[0]!.results[0]!.title).toBe("kube/x.md > Heading");
  });
});

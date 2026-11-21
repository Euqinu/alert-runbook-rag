import type { Answer } from "../query/answer.js";
import type { SearchResult } from "../query/search.js";
import type { EvalQuery } from "./queries.js";
import { matches } from "./score.js";

/**
 * Everything we keep about one question's answer. Saved to disk so the judge can be run (and a
 * human can review) later without paying for the answer again.
 */
export interface GenerationRecord {
  query: EvalQuery;
  /** Where an expected source landed in the retrieved results (null = not in them). Same number the retrieval eval reports. */
  retrievalRank: number | null;
  /** The chunks exactly as the model saw them: results[n - 1] is source [n]. */
  results: SearchResult[];
  answer: Answer;
}

/** "n/a" = the rule does not apply to this question (e.g. the unanswerable-question rule on an answerable one). */
export type RuleStatus = "pass" | "fail" | "n/a";

export const RULE_NAMES = [
  "notTruncated",
  "notRefused",
  "citationsExist",
  "noWrongRefusal",
  "unanswerableHandled",
  "answerIsCited",
] as const;
export type RuleName = (typeof RULE_NAMES)[number];
export type RuleResults = Record<RuleName, RuleStatus>;

/**
 * The free checks. None of them reads meaning: they use facts we already have (why the model
 * stopped, which [n] it wrote, what retrieval found).
 */
export function checkRules(record: GenerationRecord): RuleResults {
  const { query, answer, results } = record;
  // "Answered" = the model actually wrote something, rather than refusing or saying not-found.
  const answered = !answer.refused && !answer.notFound;
  // Did retrieval bring an expected RUNBOOK chunk? Alert chunks do not count (D16): they say what
  // an alert means but carry no fix steps, so "Not found" on an alert-only hit is defensible.
  const runbookRetrieved = results.some((r) =>
    query.expected.some((e) => "runbook" in e && matches(r, e)),
  );

  return {
    // stop_reason was "max_tokens": the answer may be missing its last steps or warnings.
    notTruncated: answer.truncated ? "fail" : "pass",
    // The safety classifiers declined; there is no answer to grade.
    notRefused: answer.refused ? "fail" : "pass",
    // Every [n] must point at a real source (1..number of sources). Existence only, not support.
    citationsExist: answer.invalidCitations.length === 0 ? "pass" : "fail",
    // "Not found" is wrong only if retrieval DID bring an expected runbook. If it missed (like
    // q32) or only found alert descriptions, refusing can be right, so the rule does not apply.
    noWrongRefusal:
      query.answerable && runbookRetrieved
        ? answer.notFound
          ? "fail"
          : "pass"
        : "n/a",
    // For a question the corpus cannot answer, the only good reply is the exact not-found sentence.
    unanswerableHandled: !query.answerable
      ? answer.notFound
        ? "pass"
        : "fail"
      : "n/a",
    // The prompt says "cite every claim": an answer with no [n] at all broke that rule.
    answerIsCited:
      query.answerable && answered
        ? answer.citations.length > 0
          ? "pass"
          : "fail"
        : "n/a",
  };
}

/** Share of non-empty answer lines that contain a [n]. Informational, not pass/fail. */
export function citationCoverage(text: string): number | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length === 0) return null;
  return lines.filter((l) => /\[\d+\]/.test(l)).length / lines.length;
}

// Sonnet 5.5 prices, USD per million tokens (Claude API reference, cached 2026-11-03).
const SONNET_INPUT_PER_MTOK = 2;
const SONNET_OUTPUT_PER_MTOK = 10;

export function answerCostUsd(
  inputTokens: number,
  outputTokens: number,
): number {
  return (
    (inputTokens * SONNET_INPUT_PER_MTOK +
      outputTokens * SONNET_OUTPUT_PER_MTOK) /
    1_000_000
  );
}

export interface RuleFailure {
  id: string;
  question: string;
  rule: RuleName;
}

export interface RuleSummary {
  questions: number;
  counts: Record<RuleName, Record<RuleStatus, number>>;
  failures: RuleFailure[];
  /** Mean citationCoverage over answerable questions that got a real answer; null if there are none. */
  meanCitationCoverage: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export function summarizeRules(records: GenerationRecord[]): RuleSummary {
  const counts = Object.fromEntries(
    RULE_NAMES.map((r) => [r, { pass: 0, fail: 0, "n/a": 0 }]),
  ) as RuleSummary["counts"];
  const failures: RuleFailure[] = [];
  const coverages: number[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const record of records) {
    const results = checkRules(record);
    for (const rule of RULE_NAMES) {
      counts[rule][results[rule]] += 1;
      if (results[rule] === "fail")
        failures.push({
          id: record.query.id,
          question: record.query.question,
          rule,
        });
    }
    if (
      record.query.answerable &&
      !record.answer.refused &&
      !record.answer.notFound
    ) {
      const c = citationCoverage(record.answer.text);
      if (c !== null) coverages.push(c);
    }
    inputTokens += record.answer.usage.inputTokens;
    outputTokens += record.answer.usage.outputTokens;
  }

  return {
    questions: records.length,
    counts,
    failures,
    meanCitationCoverage:
      coverages.length === 0
        ? null
        : coverages.reduce((a, b) => a + b, 0) / coverages.length,
    inputTokens,
    outputTokens,
    costUsd: answerCostUsd(inputTokens, outputTokens),
  };
}

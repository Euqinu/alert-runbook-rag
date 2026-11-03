import { readFile } from "node:fs/promises";
import { parse } from "yaml";

/** One acceptable answer: a runbook file (path under docs/) or an alert name. */
export type Expected = { runbook: string } | { alert: string };

export interface EvalQuery {
  id: string;
  category: string;
  question: string;
  /** false = nothing in the corpus covers it; `expected` is then empty. */
  answerable: boolean;
  expected: Expected[];
}

export async function loadQueries(
  file = "eval/queries.yaml",
): Promise<EvalQuery[]> {
  const raw = parse(await readFile(file, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${file}: expected a list`);

  const seen = new Set<string>();
  return raw.map((item: Record<string, unknown>, i) => {
    const where = `${file} entry ${i + 1}`;
    const { id, category, question } = item;
    if (typeof id !== "string" || typeof category !== "string")
      throw new Error(`${where}: id and category must be strings`);
    if (typeof question !== "string" || question.trim() === "")
      throw new Error(`${where} (${id}): question is missing`);
    if (seen.has(id)) throw new Error(`${where}: duplicate id ${id}`);
    seen.add(id);

    const answerable = item.answerable !== false;
    const expected = ((item.expected ?? []) as Record<string, unknown>[]).map(
      (e): Expected => {
        if (typeof e.runbook === "string" && e.alert === undefined)
          return { runbook: e.runbook };
        if (typeof e.alert === "string" && e.runbook === undefined)
          return { alert: e.alert };
        throw new Error(
          `${id}: each expected entry needs exactly one of runbook or alert`,
        );
      },
    );
    if (answerable && expected.length === 0)
      throw new Error(`${id}: answerable question has no expected answer`);
    if (!answerable && expected.length > 0)
      throw new Error(`${id}: unanswerable question must have empty expected`);

    return { id, category, question, answerable, expected };
  });
}

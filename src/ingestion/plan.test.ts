import { describe, expect, it } from "vitest";
import type { SourceDocument } from "./documents.js";
import { planIngestion } from "./plan.js";

const doc = (url: string, docHash: string): SourceDocument => ({
  source: "test",
  url,
  license: "MIT",
  docHash,
  chunks: [],
});

describe("planIngestion", () => {
  it("marks every document as new when the database is empty", () => {
    const plan = planIngestion([doc("a", "h1"), doc("b", "h2")], new Map());
    expect(plan.toProcess.map((p) => [p.doc.url, p.reason])).toEqual([
      ["a", "new"],
      ["b", "new"],
    ]);
    expect(plan.unchanged).toEqual([]);
  });

  it("skips documents whose stored hash matches", () => {
    const plan = planIngestion(
      [doc("a", "h1"), doc("b", "h2")],
      new Map([
        ["a", "h1"],
        ["b", "h2"],
      ]),
    );
    expect(plan.toProcess).toEqual([]);
    expect(plan.unchanged.map((d) => d.url)).toEqual(["a", "b"]);
  });

  it("rebuilds only the document whose hash differs", () => {
    const plan = planIngestion(
      [doc("redis", "NEW"), doc("patroni", "h2")],
      new Map([
        ["redis", "OLD"],
        ["patroni", "h2"],
      ]),
    );
    expect(plan.toProcess.map((p) => [p.doc.url, p.reason])).toEqual([
      ["redis", "changed"],
    ]);
    expect(plan.unchanged.map((d) => d.url)).toEqual(["patroni"]);
  });

  it("mixes new, changed and unchanged in one run", () => {
    const plan = planIngestion(
      [doc("new", "x"), doc("changed", "y2"), doc("same", "z")],
      new Map([
        ["changed", "y1"],
        ["same", "z"],
      ]),
    );
    expect(plan.toProcess.map((p) => p.reason)).toEqual(["new", "changed"]);
    expect(plan.unchanged).toHaveLength(1);
  });
});

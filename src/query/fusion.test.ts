import { describe, expect, it } from "vitest";
import { fuseRRF } from "./fusion.js";

const id = (s: string) => s;

// The worked example from docs/LEARNING_NOTES.md section 34 ("pgbouncer pool full").
const vector = ["Alert-X", "Runbook-A", "Runbook-B", "Runbook-C", "Alert-Y"];
const text = ["Runbook-B", "Runbook-D", "Runbook-A", "Runbook-E", "Runbook-F"];

describe("fuseRRF", () => {
  it("adds 1 / (60 + position) over the lists an item appears in", () => {
    const fused = fuseRRF([vector, text], id);
    const score = (name: string) => fused.find((f) => f.item === name)!.score;
    expect(score("Runbook-B")).toBeCloseTo(1 / 63 + 1 / 61, 10); // 3rd + 1st
    expect(score("Runbook-A")).toBeCloseTo(1 / 62 + 1 / 63, 10); // 2nd + 3rd
    expect(score("Alert-X")).toBeCloseTo(1 / 61, 10); // 1st in one list only
  });

  it("puts items found by both lists ahead of an item that was first in only one", () => {
    const names = fuseRRF([vector, text], id, { limit: 5 }).map((f) => f.item);
    // B, A: in both lists. X: only 1st in vector. D: only 2nd in text.
    // C and E tie (4th in one list each); the first list (vector) wins the tie, so C.
    expect(names).toEqual([
      "Runbook-B",
      "Runbook-A",
      "Alert-X",
      "Runbook-D",
      "Runbook-C",
    ]);
  });

  it("records each item's position in each list (null = absent)", () => {
    const fused = fuseRRF([vector, text], id);
    const find = (name: string) => fused.find((f) => f.item === name)!;
    expect(find("Runbook-A").ranks).toEqual([2, 3]);
    expect(find("Alert-X").ranks).toEqual([1, null]);
    expect(find("Runbook-D").ranks).toEqual([null, 2]);
  });

  it("breaks equal scores by the first list, then the second, so the order is stable", () => {
    // a (1st in list 1) and b (1st in list 2) both score 1/61; v2 and t2 both score 1/62.
    // The first list wins each tie.
    const names = fuseRRF(
      [
        ["a", "v2"],
        ["b", "t2"],
      ],
      id,
    ).map((f) => f.item);
    expect(names).toEqual(["a", "b", "v2", "t2"]);
  });

  it("ignores everything but position: the lists' own scores never enter", () => {
    // Items are objects carrying a made-up score; reversing the scores changes nothing.
    const a = [
      { n: "x", s: 0.1 },
      { n: "y", s: 0.9 },
    ];
    const b = [
      { n: "x", s: 99 },
      { n: "y", s: -5 },
    ];
    const fused = fuseRRF([a, b], (i) => i.n);
    expect(fused.map((f) => f.item.n)).toEqual(["x", "y"]);
  });

  it("handles empty lists, a single list, and limit", () => {
    expect(fuseRRF([[], []], id)).toEqual([]);
    expect(fuseRRF([["a", "b"], []], id).map((f) => f.item)).toEqual([
      "a",
      "b",
    ]);
    expect(fuseRRF([["a", "b", "c"]], id, { limit: 2 })).toHaveLength(2);
  });

  it("counts a duplicate inside one list once, at its best position", () => {
    const fused = fuseRRF([["a", "b", "a"]], id);
    expect(fused.map((f) => f.item)).toEqual(["a", "b"]);
    expect(fused[0]!.score).toBeCloseTo(1 / 61, 10);
  });

  it("a larger constant makes position matter less", () => {
    const gap = (constant: number) => {
      const [first, second] = fuseRRF([["a", "b"]], id, { constant });
      return first!.score - second!.score;
    };
    expect(gap(1)).toBeGreaterThan(gap(60));
  });
});

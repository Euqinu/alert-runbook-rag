import { describe, expect, it } from "vitest";
import type { Judgement, JudgeScore } from "./judge.js";
import { PLANTS, replaceOnce } from "./plant.js";

describe("replaceOnce", () => {
  it("replaces a single occurrence", () => {
    expect(replaceOnce("a b c", "b", "X")).toBe("a X c");
  });

  it("throws when the target is missing, so a plant is never a silent no-op", () => {
    expect(() => replaceOnce("a b c", "z", "X")).toThrow(/exactly once/);
  });

  it("throws when the target is ambiguous", () => {
    expect(() => replaceOnce("b b", "b", "X")).toThrow(/exactly once/);
  });
});

const score = (over: Partial<JudgeScore>): JudgeScore => ({
  claims: 5,
  supported: 5,
  miscited: 0,
  unsupported: 0,
  contradicted: 0,
  faithfulness: 1,
  citationAccuracy: 1,
  completeness: 3,
  unverifiedQuotes: 0,
  pass: true,
  ...over,
});
const none: Judgement = { claims: [], omissions: [] };
const plant = (name: string) => PLANTS.find((p) => p.name === name)!;

describe("plant.caught", () => {
  it("control is 'caught' only when the good answer passes", () => {
    expect(plant("control").caught(none, score({ pass: true }))).toBe(true);
    expect(plant("control").caught(none, score({ pass: false }))).toBe(false);
  });

  it("invented_step needs an UNSUPPORTED claim and a failed answer", () => {
    const p = plant("invented_step");
    expect(p.caught(none, score({ unsupported: 1, pass: false }))).toBe(true);
    expect(p.caught(none, score({ pass: true }))).toBe(false);
  });

  it("dropped_warning needs a warning omission", () => {
    const p = plant("dropped_warning");
    const warned: Judgement = {
      claims: [],
      omissions: [{ kind: "warning", text: "t", source: 4 }],
    };
    expect(p.caught(warned, score({ completeness: 1, pass: false }))).toBe(
      true,
    );
    expect(p.caught(none, score({ completeness: 1, pass: false }))).toBe(false);
  });
});

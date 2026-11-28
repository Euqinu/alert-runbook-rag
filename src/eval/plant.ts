import type { Judgement, JudgeScore } from "./judge.js";

/**
 * Planted-error test (D15, "does the judge catch a made-up step?").
 *
 * Take one answer we have read and know is good (q18), break it in ONE known way, and see whether
 * the judge notices. If it does not, we have found a blind spot before it hides in the real numbers.
 * A "control" (the answer left untouched) is run too: a judge that fails everything would "catch"
 * every plant, so we also need to see it PASS a good answer.
 */

/** Replace `find` with `replacement`, but only if `find` occurs exactly once. A plant must never be a silent no-op. */
export function replaceOnce(
  text: string,
  find: string,
  replacement: string,
): string {
  const parts = text.split(find);
  if (parts.length !== 2)
    throw new Error(
      `plant target must occur exactly once, found ${parts.length - 1}x: "${find.slice(0, 60)}"`,
    );
  return parts[0]! + replacement + parts[1]!;
}

export type PlantName =
  | "control"
  | "invented_step"
  | "wrong_citation"
  | "opposite"
  | "dropped_warning";

export interface Plant {
  name: PlantName;
  /** What we change, in one line (for the report). */
  change: string;
  /** What a good judge should say. */
  expected: string;
  apply: (answerText: string) => string;
  /** Did the judge do what we expected? */
  caught: (judgement: Judgement, score: JudgeScore) => boolean;
  /** Text that must NOT appear in any source, proving the plant is really invented. */
  mustBeAbsentFromSources?: string;
}

// Step 2 of the saved q18 answer, word for word. Every plant that touches it uses this exact text.
const STEP_2 =
  "2. **Do not use `helm rollback`.** It rolls running code back to a previous version, which may be unsafe because post-deployment migrations may already have run. Always roll forward when Helm is stuck [4].";

const INVENTED_COMMAND = "kubectl rollout restart deploy/gitlab-gitlab-pages";

export const PLANTS: Plant[] = [
  {
    name: "control",
    change: "none: the original answer, untouched",
    expected: "PASS (a good answer must not be failed)",
    apply: (t) => t,
    caught: (_j, s) => s.pass,
  },
  {
    name: "invented_step",
    change: `add a step "${INVENTED_COMMAND}" with a [5] citation`,
    expected: "UNSUPPORTED claim, answer FAILS",
    apply: (t) =>
      `${t}\n\n9. Restart the affected pods with \`${INVENTED_COMMAND}\` to clear the stuck state [5].`,
    caught: (_j, s) => s.unsupported >= 1 && !s.pass,
    mustBeAbsentFromSources: "rollout restart",
  },
  {
    name: "wrong_citation",
    change: "step 2 cites [2] instead of [4] (source 2 does not say it)",
    expected: "MISCITED claims (source 4 still says it, but was not cited)",
    apply: (t) => replaceOnce(t, STEP_2, STEP_2.replace("[4]", "[2]")),
    caught: (_j, s) => s.miscited >= 1,
  },
  {
    name: "opposite",
    change: "step 2 says helm rollback is SAFE and recommended",
    expected: "CONTRADICTED claim, answer FAILS",
    apply: (t) =>
      replaceOnce(
        t,
        STEP_2,
        "2. **Using `helm rollback` is safe.** It rolls running code back to a previous version, and post-deployment migrations are not a concern. Rolling back is the recommended way to recover when Helm is stuck [4].",
      ),
    caught: (_j, s) => s.contradicted >= 1 && !s.pass,
  },
  {
    name: "dropped_warning",
    change: "delete step 2, the only 'Do not use helm rollback' warning",
    expected: "omission of kind `warning`, completeness 1, answer FAILS",
    apply: (t) => replaceOnce(t, `${STEP_2}\n\n`, ""),
    caught: (j, s) => j.omissions.some((o) => o.kind === "warning") && !s.pass,
  },
];

import type { GenerationRecord } from "./generation.js";
import {
  needsJudge,
  rulesFor,
  scoreJudgement,
  type JudgeCall,
  type JudgeScore,
} from "./judge.js";

export interface JudgedRecord {
  id: string;
  /** null when the judge call failed (see call.error). */
  score: JudgeScore | null;
  call: JudgeCall;
}

type JudgeFn = (record: GenerationRecord) => Promise<JudgeCall>;

/**
 * Judge every record that has something to judge (bare "Not found" replies and refusals are
 * skipped: nothing to grade, and no reason to pay Opus for it). One at a time; `onResult` is
 * called after each so the caller can save progress.
 */
export async function runJudge(
  records: GenerationRecord[],
  judge: JudgeFn,
  onResult?: (result: JudgedRecord, all: JudgedRecord[]) => Promise<void>,
): Promise<{ judged: JudgedRecord[]; skipped: GenerationRecord[] }> {
  const judged: JudgedRecord[] = [];
  const skipped: GenerationRecord[] = [];
  for (const record of records) {
    if (!needsJudge(record)) {
      skipped.push(record);
      continue;
    }
    const call = await judge(record);
    const result: JudgedRecord = {
      id: record.query.id,
      call,
      score: call.judgement
        ? scoreJudgement(call.judgement, rulesFor(record), record.results)
        : null,
    };
    judged.push(result);
    await onResult?.(result, judged);
  }
  return { judged, skipped };
}

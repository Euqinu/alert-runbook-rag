# Eval Results

Updated after every retrieval change (Phase 3 onward). Run with `npm run eval` (optional argument = K, default 5).

Eval set: `eval/queries.yaml`, 44 questions (40 answerable, 4 not in the corpus). Hit rate and MRR are computed over the 40 answerable questions only. A hit means any expected runbook file or alert name appears in the top K.

| Date       | Change                                  | hit@1 | Hit rate@5 | MRR   | Notes                                                                |
| ---------- | --------------------------------------- | ----- | ---------- | ----- | -------------------------------------------------------------------- |
| 2026-11-02 | Baseline: vector search only, HNSW, K=5 | 80.0% | 97.5%      | 0.865 | 1 miss (q32). 7 more found but not first, mostly behind alert chunks |

## Baseline by category (2026-11-02)

| Category         | n   | hit@1  | hit@5  | MRR   |
| ---------------- | --- | ------ | ------ | ----- |
| exact-alert-name | 10  | 100.0% | 100.0% | 1.000 |
| symptom          | 21  | 76.2%  | 100.0% | 0.859 |
| vague            | 4   | 25.0%  | 75.0%  | 0.396 |
| pasted-alert     | 5   | 100.0% | 100.0% | 1.000 |

## Baseline observations

- **The one miss, q32** ("database is slow right now and users are complaining"): expected `patroni/performance-degradation-troubleshooting.md`. Got `database_peak_analysis.md` three times (the same title, distance 0.509 each) plus two `rails-sql-apdex-slow.md` chunks. Two findings: vague questions are the weak spot, and **near-identical chunks crowd the top 5** (three slots spent on one section).
- **Found but not first (7):** q14, q15, q16, q25, q30, q33 have a relevant ALERT chunk in first place (e.g. "Elasticsearch disk out of space", "Postgresql dead locks") and the expected runbook second to fifth. Those alert chunks are plausible answers that the answer key did not list, but they do not contain fix steps, which is the project's goal. Decision (D12): alert chunks do not count as correct for symptom and vague questions, because they carry no fix steps. q34 is a real weak result: the top hit is `KubernetesClusterZombieProcesses.md`; the right alert is 4th.
- **Not-in-corpus questions:** top-1 distance 0.49 to 0.60 (median 0.59), against a median of 0.35 for answerable questions that were correct at #1. A distance cutoff may separate them, but n = 4 is too small to pick a number, and the failing q32 sat at 0.51, inside the unanswerable range.

## Caveats

- 40 answerable questions: one question moves hit rate by 2.5 points.
- Marking is file-level, so finding the wrong section of the right file still counts as a hit.
- The set was drafted with Claude from the sources (see D11) and reviewed by me before the baseline run.

# Eval Results

Updated after every retrieval change (Phase 3 onward). Run with `npm run eval` (optional argument = K, default 5).

Eval set: `eval/queries.yaml`, now 69 questions (62 answerable, 7 not in the corpus). Hit rate and MRR are computed over the answerable questions only. A hit means any expected runbook file or alert name appears in the top K.

**Note (2026-11-20):** round 2 added q45 to q69 (D14). The 2026-11-02 row was measured on the ORIGINAL 44 questions (q01 to q44, 40 answerable). The 2026-11-20 row is the same search code run on all 69. The split rows are derived by arithmetic from the run's failure and "found but not first" lists (the code does not report subsets yet), so treat the round-2-only MRR as approximate.

| Date       | Set                      | Change                                  | hit@1 | Hit rate@5 | MRR     | Notes                                                                                          |
| ---------- | ------------------------ | --------------------------------------- | ----- | ---------- | ------- | ---------------------------------------------------------------------------------------------- |
| 2026-11-02 | original 44 (40 answ.)   | Baseline: vector search only, HNSW, K=5 | 80.0% | 97.5%      | 0.865   | 1 miss (q32). 7 more found but not first, mostly behind alert chunks                           |
| 2026-11-20 | all 69 (62 answ.)        | No search change; added round 2         | 80.6% | 98.4%      | 0.876   | 1 miss (q32, same as before). 11 found but not first                                           |
| 2026-11-20 | round 2 only (22 answ.)  | derived from the run above              | 81.8% | 100.0%     | ~0.89   | 0 misses. 4 found but not first: q47, q52, q61, q65                                            |

The original 44 are unchanged (same miss, same 7 not-first), as expected: the search code did not change between the runs. Round 2 scored **slightly higher**, not lower. Prediction in notes section 23 was wrong.

## Baseline by category (2026-11-02)

| Category         | n   | hit@1  | hit@5  | MRR   |
| ---------------- | --- | ------ | ------ | ----- |
| exact-alert-name | 10  | 100.0% | 100.0% | 1.000 |
| symptom          | 21  | 76.2%  | 100.0% | 0.859 |
| vague            | 4   | 25.0%  | 75.0%  | 0.396 |
| pasted-alert     | 5   | 100.0% | 100.0% | 1.000 |

## All 69 by category (2026-11-20)

| Category         | n   | hit@1  | hit@5  | MRR   |
| ---------------- | --- | ------ | ------ | ----- |
| ALL (answerable) | 62  | 80.6%  | 98.4%  | 0.876 |
| exact-alert-name | 10  | 100.0% | 100.0% | 1.000 |
| symptom          | 27  | 77.8%  | 100.0% | 0.872 |
| vague            | 5   | 40.0%  | 80.0%  | 0.517 |
| pasted-alert     | 6   | 100.0% | 100.0% | 1.000 |
| paraphrase       | 2   | 50.0%  | 100.0% | 0.667 |
| how-to           | 6   | 100.0% | 100.0% | 1.000 |
| alert-only       | 4   | 75.0%  | 100.0% | 0.833 |
| messy            | 1   | 100.0% | 100.0% | 1.000 |
| multi-symptom    | 1   | 0.0%   | 100.0% | 0.500 |

Groups of 1 to 6 questions are anecdotes, not percentages (one question in a group of 2 is 50 points). Use them to find WHICH questions failed.

## Observations from the 69-question run (2026-11-20)

- **Overall barely moved** (hit@5 97.5% to 98.4%, MRR 0.865 to 0.876). The new question styles were not much harder for vector search. A high score on this set is therefore weaker evidence than it looks: either the system is good, or the set is still too easy, or both.
- **Weak spot is still order and vague questions**, not finding. 11 questions found but not first. In most, an ALERT chunk ranks first and the runbook is 2nd to 5th (q14, q15, q16, q25, q30, q33, q61). Others: q34 (zombie-processes runbook first), q47 (scheduling-failures first, expected GKENodeCountCritical second), q52 (a section of `postgres.md` first, expected xmin runbook third), q65 (an unrelated disk-IO alert first on a 4-symptom incident message).
- **q32 again** (the only miss): top 3 results are the same chunk text at 0.509. Duplicate chunks waste 3 of 5 slots. Candidate fix for Phase 5/6: de-duplicate identical chunk text before returning results.
- **Round-2 questions that worked well:** all 6 how-to, the pasted alert, the typo question and every alert-only question reached the top 5. Paraphrase q45 (no shared keywords) was found at #1 and q61 (TLS vs SSL) at #3.
- **Unanswerable questions (7), top-1 distance:** 0.471 to 0.590 (median 0.541), against a median of 0.350 for answerable questions correct at #1 (n = 50). Each unanswerable question still returns something plausible-looking: an unrelated alert (GitLab Sidekiq queue, Cassandra authentication, WireGuard handshake, Traefik reload) or a nearby runbook (KubeSchedulingFailures for EKS). The near-misses q67 (0.471) and q68 (0.485) are the closest to q32's failed 0.509. A single distance cutoff would be fragile: it needs the full distribution of correct top-1 distances, not medians. Not decided; Phase 4 currently lets the model decide "not found".

## Baseline observations (original 44, 2026-11-02)

- **The one miss, q32** ("database is slow right now and users are complaining"): expected `patroni/performance-degradation-troubleshooting.md`. Got `database_peak_analysis.md` three times (the same title, distance 0.509 each) plus two `rails-sql-apdex-slow.md` chunks. Two findings: vague questions are the weak spot, and **near-identical chunks crowd the top 5** (three slots spent on one section).
- **Found but not first (7):** q14, q15, q16, q25, q30, q33 have a relevant ALERT chunk in first place (e.g. "Elasticsearch disk out of space", "Postgresql dead locks") and the expected runbook second to fifth. Those alert chunks are plausible answers that the answer key did not list, but they do not contain fix steps, which is the project's goal. Decision (D12): alert chunks do not count as correct for symptom and vague questions, because they carry no fix steps. q34 is a real weak result: the top hit is `KubernetesClusterZombieProcesses.md`; the right alert is 4th.
- **Not-in-corpus questions:** top-1 distance 0.49 to 0.60 (median 0.59), against a median of 0.35 for answerable questions that were correct at #1. A distance cutoff may separate them, but n = 4 is too small to pick a number, and the failing q32 sat at 0.51, inside the unanswerable range.

## Generation eval, rules layer (2026-11-21)

Run: `npm run eval:gen`, Sonnet 5.5 writes an answer for each of the 69 questions from the top 5 chunks. Answers saved in `eval/runs/gen-2026-11-21T06-59-45.834Z.json`. Cost $0.587 (124,338 tokens in, 33,846 out). No judge yet.

| rule | pass | fail | n/a |
| ---- | ---- | ---- | --- |
| notTruncated | 69 | 0 | 0 |
| notRefused | 69 | 0 | 0 |
| citationsExist | 69 | 0 | 0 |
| noWrongRefusal, first version (any expected source retrieved) | 53 | 8 | 8 |
| noWrongRefusal, revised (D16: only runbook hits) | 46 | 3 | 20 |
| unanswerableHandled (7 not-in-corpus) | 7 | 0 | 62 |
| answerIsCited | 54 | 0 | 15 |

- **54 answered, 15 "Not found"** (7 unanswerable + 8 flagged). Mean share of answer lines with a citation: 77.6%.
- **8 flagged by noWrongRefusal:** q15, q25, q33, q38, q39, q59, q60, q61. Reading them: 6 are alert-only chunks with no steps (the expected "hit" was an alert description), 2 are right file but wrong section (q15, q25). So the flags point at the answer key and chunk granularity more than at the writer. See notes section 29. Whether to restrict this rule to runbook hits is an open decision; if adopted, the original figure (8 flagged) stays recorded here.
- All 7 unanswerable questions, including the near-misses (EKS/Karpenter, DynamoDB, OpenShift), got exactly the not-found sentence and nothing else.
- **Revised rule (D16, 2026-11-21):** after the decision to count only runbook hits, the same saved answers were re-scored (no new API calls): 3 flagged (q15, q25, q39), 20 not applicable. q33, q38, q59, q60, q61 dropped out because their only retrieved "hit" was an alert description.
- Rules prove the answer is well-formed, not that it is grounded. Groundedness is the judge's job (next).

## Caveats

- 62 answerable questions (40 in the original baseline): one question moves hit rate by 1.6 points (2.5 in the original).
- Marking is file-level, so finding the wrong section of the right file still counts as a hit.
- The set was drafted with Claude from the sources (see D11) and reviewed by me before the baseline run.

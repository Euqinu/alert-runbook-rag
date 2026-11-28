# Eval Results

Updated after every retrieval change (Phase 3 onward). Run with `npm run eval` (optional argument = K, default 5).

Eval set: `eval/queries.yaml`, now 69 questions (62 answerable, 7 not in the corpus). Hit rate and MRR are computed over the answerable questions only. A hit means any expected runbook file or alert name appears in the top K.

**Note (2026-11-20):** round 2 added q45 to q69 (D14). The 2026-11-02 row was measured on the ORIGINAL 44 questions (q01 to q44, 40 answerable). The 2026-11-20 row is the same search code run on all 69. The split rows are derived by arithmetic from the run's failure and "found but not first" lists (the code does not report subsets yet), so treat the round-2-only MRR as approximate.

| Date       | Set                      | Change                                  | hit@1 | Hit rate@5 | MRR     | Notes                                                                                          |
| ---------- | ------------------------ | --------------------------------------- | ----- | ---------- | ------- | ---------------------------------------------------------------------------------------------- |
| 2026-11-02 | original 44 (40 answ.)   | Baseline: vector search only, HNSW, K=5 | 80.0% | 97.5%      | 0.865   | 1 miss (q32). 7 more found but not first, mostly behind alert chunks                           |
| 2026-11-20 | all 69 (62 answ.)        | No search change; added round 2         | 80.6% | 98.4%      | 0.876   | 1 miss (q32, same as before). 11 found but not first                                           |
| 2026-11-20 | round 2 only (22 answ.)  | derived from the run above              | 81.8% | 100.0%     | ~0.89   | 0 misses. 4 found but not first: q47, q52, q61, q65                                            |
| 2026-11-28 | all 69 (62 answ.)        | Re-run of the vector baseline           | 80.6% | 98.4%      | 0.876   | Identical to 2026-11-20, so the baseline reproduces. `eval/runs/retrieval-vector-2026-11-28T00-38-53.602Z.json` |
| 2026-11-28 | all 69 (62 answ.)        | **Hybrid: vector + full-text, RRF, depth 20, K=5** (D18, D19) | 77.4% | 95.2%      | 0.847   | **Worse than the baseline on all three.** Better on 6 questions, worse on 8; 3 misses (q32, q34, q38). See "Hybrid vs baseline" below. `eval/runs/retrieval-hybrid-2026-11-28T00-39-02.222Z.json` |

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

## Generation eval, judge pilot (2026-11-24)

Judge: Opus 5.5, `effort: medium`, JSON output. Pilot on 3 saved answers from the 2026-11-21 run (`eval/runs/judge-2026-11-24T06-34-39.073Z.json`). Not a result, only a check that the pipeline works and a cost measurement.

| question | claims | S / M / U / C | completeness | quotes not found | verdict | judge tokens in / out (thinking) |
| -------- | ------ | ------------- | ------------ | ---------------- | ------- | -------------------------------- |
| q18 helm | 25 | 25 / 0 / 0 / 0 | 3 | 0 | PASS | 4,314 / 2,848 (387) |
| q32 slow database | 6 | 6 / 0 / 0 / 0 | 3 | 0 | PASS | 2,791 / 604 (0) |
| q25 redis | 7 | 7 / 0 / 0 / 0 | 3 | 0 | FAIL (free rule `noWrongRefusal`, not the judge) | 2,425 / 621 (0) |

(S supported, M miscited, U unsupported, C contradicted.) Cost $0.120 for 3 calls, about $0.04 per call. Projection for the full run: 57 judgeable answers, about $2.50 (rough range $2 to $4, from 3 samples). The 12 bare "Not found" replies (7 unanswerable, 5 answerable) are skipped.

**Limitation:** all 38 claims were SUPPORTED, so the judge has not yet been shown a bad answer. Until the planted-error test and your blind hand reviews are done, "the judge found no problems" must not be read as "the answers have no problems".

## Generation eval, planted-error test on q18 (2026-11-25)

Take the saved q18 answer (read by hand, good), break it in one known way, and see whether the Opus 5.5 judge notices. Run: `npm run eval:plant -- --from eval/runs/gen-2026-11-21T06-59-45.834Z.json`, saved in `eval/runs/plant-2026-11-25T01-35-54.956Z.json`. The judge here already includes D17 (a fake quote fails the answer). Only ONE answer and ONE plant per type, so this shows the judge CAN say no, not how often it does.

| plant | S / M / U / C | completeness | quotes not found | verdict | what the judge said |
| ----- | ------------- | ------------ | ---------------- | ------- | ------------------- |
| control (answer untouched) | 23 / 0 / 0 / 0 | 3 | 0 | PASS | all claims grounded |
| invented step (`kubectl rollout restart ...` cited to [5]) | 22 / 0 / 1 / 0 | 3 | 0 | FAIL | the one invented step was UNSUPPORTED, nothing else |
| wrong citation (step 2 cites [2], not [4]) | 20 / 3 / 0 / 0 | 3 | 0 | **PASS** | exactly the 3 step-2 claims MISCITED |
| opposite ("helm rollback is safe") | 21 / 0 / 0 / 3 | 1 | 0 | FAIL | 3 claims CONTRADICTED, and the lost warning was listed as an omission |
| dropped warning (step 2 deleted) | 18 / 0 / 0 / 0 | 1 | 0 | FAIL | the missing "Do not use helm rollback" warning, named correctly |

5 of 5 behaved as expected. Cost $0.344 for 5 calls (21,555 tokens in, 12,867 out), about $0.07 per call.

**Findings:**
- The judge says no, and it says it precisely: no false alarms on the other claims in any plant (one invented step among 23 claims flagged exactly one). The control passed.
- **A MISCITED claim does not fail the answer.** The wrong-citation plant got 3 MISCITED claims and still PASSED, because PASS only looks at UNSUPPORTED, CONTRADICTED, completeness, the free rules and (D17) bad quotes. Citation accuracy drops (20/23 = 87%) and is reported, but it is not part of PASS. Open decision, see D15 status.
- **Judge runs are not identical:** the pilot split the same untouched q18 answer into 25 claims, this run into 23. The verdict was the same, but claim COUNTS and therefore percentages wobble between runs. Compare labels and verdicts, not exact counts.
- **Cost estimate was low:** I estimated about $0.16 from the pilot's $0.04 average; real cost was $0.34. q18 is a long answer (about 23 to 25 claims) and was the most expensive pilot call too ($0.074). The full-run projection of about $2.50 uses an average dragged down by two short answers, so treat $2.50 as a floor and expect more for long answers.

## Generation eval, judge on the saved answers (2026-11-25): 55 of 57, PARTIAL

Judge: Opus 5.5, `effort: medium`, D17 in force (a fake quote fails the answer), D15 addendum (MISCITED does not fail). Answers from `gen-2026-11-21T06-59-45.834Z.json`, judgements in `eval/runs/judge-2026-11-25T01-48-12.224Z.json`. **The run stopped after 55 answers because the API credit balance ran out** (HTTP 400, billing). q65 and q66 are not judged yet. Numbers below cover the 55 only. The judge has not yet been checked against your hand reviews, so these are the judge's verdicts, not ground truth.

| measure | value |
| ------- | ----- |
| answers judged | 55 of 57 (12 bare "Not found" replies skipped) |
| PASS | 48 of 55 (87%) |
| claims | 644: 636 SUPPORTED, 4 MISCITED, 4 UNSUPPORTED, 0 CONTRADICTED |
| faithfulness (SUPPORTED / all claims) | 98.8% |
| citation accuracy (SUPPORTED / (SUPPORTED + MISCITED)) | 99.4% |
| completeness 3 / 2 / 1 / 0 | 30 / 25 / 0 / 0 |
| quotes not found in the named source | 1 |
| cost | $2.379 for 55 calls, $0.043 per call |

The 7 FAILs:

| question | why it failed | kind |
| -------- | ------------- | ---- |
| q13 locks | 1 UNSUPPORTED: "Use the pid of the root blocker (lvl 0) ... when cancelling/terminating" | judge says invented; to check by hand |
| q37 redis alert | 1 UNSUPPORTED: "These related alerts may fire alongside the replication broken alert" | same |
| q51 table bloat | 1 UNSUPPORTED: "Prioritize the indexes, since high index bloat is usually more dangerous for performance" | looks like outside knowledge; to check |
| q63 HostOutOfInodes | 1 UNSUPPORTED: "Check whether the warning alert also fired for this host" | to check |
| q53 Rails apdex | 0 bad claims; 1 quote not found. The judge wrote "it is important to quickly asses..." but source 3 says "When we see an SQL Apdex alert is important to quickly asses...": the judge added "it" | **a correct answer failed by D17 (the predicted trade-off)** |
| q15 elasticsearch, q25 redis | free rule `noWrongRefusal` (wrote "Not found" although the runbook chunk was retrieved); the judge found every claim grounded | known, D16 |

**What this says:**
- The writer is mostly faithful: 4 unsupported claims in 644. But the 4 UNSUPPORTED findings are the judge's opinion; read each against its chunks (they are candidates for your 10 hand reviews).
- Zero CONTRADICTED and zero "completeness 1": the judge never found a missed warning or key step in 55 answers. The planted test showed it CAN catch a dropped warning, so this is probably good news, but a judge that is lenient about omissions would look the same. Your hand reviews are the check.
- D17 has now cost one false FAIL out of 55 (q53): small, but real. Whitespace and case are normalised; a missing word is not. Option: fuzzy quote matching, not done.
- Cost matched the estimate ($2.38 for 55, about $2.46 for 57). My worry after the plant test that $2.50 was a floor was wrong: the plant test used q18, the most expensive answer.

## Caveats

- 62 answerable questions (40 in the original baseline): one question moves hit rate by 1.6 points (2.5 in the original).
- Marking is file-level, so finding the wrong section of the right file still counts as a hit.
- The set was drafted with Claude from the sources (see D11) and reviewed by me before the baseline run.

## Hybrid vs baseline (2026-11-28, Phase 5 step 5c)

Same 69 questions, K=5. Hybrid = vector search + full-text search, each giving its top 20, fused with RRF (constant 60, equal weights, D18 and D19). Run with `npm run eval -- 5 hybrid 20`; the vector baseline with `npm run eval -- 5 vector`.

| measure | vector (baseline) | hybrid | change |
| ------- | ----------------- | ------ | ------ |
| hit@1 | 80.6% (50/62) | 77.4% (48/62) | -3.2 pts (2 questions) |
| hit@5 | 98.4% (61/62) | 95.2% (59/62) | -3.2 pts (2 questions) |
| MRR | 0.876 | 0.847 | -0.029 |

**By category (hit@1, hit@5):**

| category | n | vector | hybrid |
| -------- | - | ------ | ------ |
| exact-alert-name | 10 | 100%, 100% | 100%, 100% |
| symptom | 27 | 77.8%, 100% | **85.2%, 100%** (better) |
| vague | 5 | 40%, 80% | 40%, 60% (worse at 5) |
| pasted-alert | 6 | 100%, 100% | **50%, 83.3%** (much worse) |
| paraphrase | 2 | 50%, 100% | 50%, 100% |
| how-to | 6 | 100%, 100% | 100%, 100% |
| alert-only | 4 | 75%, 100% | **25%, 100%** (worse at 1) |
| messy | 1 | 100%, 100% | 100%, 100% |
| multi-symptom | 1 | 0%, 100% | 100%, 100% |

**Better in hybrid (6):** q14 #2 to #1, q30 #2 to #1, q33 #3 to #1, q65 #2 to #1, q16 #5 to #4, q52 #3 to #2. Mostly symptom questions in plain words, where the runbook was found by both searchers.

**Worse in hybrid (8):** q38 #1 to miss, q34 #4 to miss, q35 #1 to #4, q15 #3 to #5, q40, q59, q60, q63 each #1 to #2.

**Why pasted alerts got worse (checked in the database):**
- q38 pastes `[FIRING] KubePodCrashLooping namespace=payments pod=api-7f9d5c-xk2lm restarts=14 in 15m`. The expected chunk is the alert chunk "Kubernetes pod crash looping". The token `kubepodcrashloop` appears in **0 chunks in the whole table** (same for `hostoutofinodes`, q63): the alert chunks from `rules.yml` are written in plain words ("Alert: Kubernetes pod crash looping"), not in the CamelCase name a real alert message carries. So keyword search gets no benefit from the exact name here.
- What keyword search matches instead are the common words (`pod`, `namespace`, `restarts`, `payments`) in long runbook sections. `ts_rank` counts matches and has no idea that these words are common, so unrelated `KubeSchedulingFailures.md` chunks took ranks 1 to 3 and the vector search's correct #1 (the alert chunk) was pushed out of the top 5. Vector search handled this question correctly on its own.
- **A flaw in my 5a query (not yet fixed):** `websearch_to_tsquery` turns punctuation-joined tokens into PHRASE operators. The q38 query became `'fire' & 'kubepodcrashloop' & 'namespac' <-> 'payment' & 'pod' <-> 'api-7f9d5c-xk2lm' <-> ... & 'restart' <-> '14' & '15m'`. My `&` to `|` replacement left the `<->` (adjacent word) operators in place, so it is not a pure OR query. Needs a decision in D18's revisit.
- **Alert-only questions (q59, q60):** hit@5 is still 100%, but a related alert ("MySQL Galera donor falling behind", "Redis master link down") now outranks the expected one, because the keyword search favours the shared words ("mysql", "master") without knowing which is the better match.

**What this says (and does not):**
- Hybrid is not a free win on this corpus. The reasons I predicted (alert chunk outranking the runbook not fixed by keywords; `ts_rank` having no word rarity) were partly right. The reason I did NOT predict is the alert-name format: the eval's pasted alerts use CamelCase names that the alert chunks do not contain.
- The gains (6 questions) are real but small; the losses (8) include 2 outright misses. With 62 answerable questions, one question moves hit rate 1.6 points, so a difference of 2 questions is small. The pasted-alert category (n=6) is a drop of 3 questions at rank 1, which is too large to be noise.
- Only ONE setting was tried: depth 20, constant 60, equal weights. This is NOT a verdict on hybrid search in general, only on this configuration and this query builder.

**Candidate next experiments (one at a time, each its own row):** (1) depth 5 vs 20; (2) a weight below 1 on the full-text list; (3) fix the phrase-operator flaw in the query builder; (4) index the CamelCase alert name (for example add it to the chunk text) so exact names can match; (5) a re-ranker (Phase 6) to prefer runbook chunks. None run yet.

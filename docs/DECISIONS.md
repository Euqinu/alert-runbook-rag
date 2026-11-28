# Design Decisions

Format: context, options, choice, why.

## D1. Chunks table schema (2026-10-05)

- **Context:** need one table serving vector search, full-text search, and citations.
- **Options:** separate tables per search type vs one table with both columns.
- **Choice:** single `chunks` table with `embedding vector(1024)` and a generated `tsv` column; citation metadata `NOT NULL` where required (source, url, license).
- **Why:** one row = one retrievable unit, so both searches return the same ids and can be fused with RRF. `tsv` is generated so it can't drift from `text`.
- **Added beyond the plan:** `doc_hash` (skip unchanged docs, Phase 1), `chunk_index` (ordering and uniqueness), `created_at`.
- **Open:** the `1024` dimension is a placeholder until the embedding model is chosen (Phase 1). Changing it means re-embedding.

## D2. Data sources (2026-10-05)

- **Choice:** awesome-prometheus-alerts (CC BY 4.0) for alert names and meanings, plus a filtered subset of GitLab runbooks (MIT) for remediation steps.
- **Why:** both have explicit permissive licenses. The first has many alerts, the second has real fix steps. Postmortem collections were rejected because they lack a license.

## D3. Migrations: plain SQL files plus a tiny runner (2026-10-05)

- **Choice:** `migrations/*.sql` applied in filename order, tracked in `schema_migrations`, each in a transaction.
- **Why:** simplest thing that works; no migration library to learn or depend on.

## D4. Chunking the Prometheus rules (2026-10-05)

- **Context:** `rules.yml` has 1,162 rules, each short (chunk text 85-632 chars, median 231). Nested group > service > exporter > rule.
- **Options:** fixed-size splits (e.g. every 500 chars) vs one chunk per rule.
- **Choice:** one chunk per rule, no size cap, no overlap. Text = alert name, `Service (Group)` context, severity, description, comments. PromQL `query` excluded.
- **Why:** a rule is the natural unit. Fixed splits would cut rules mid-way and separate the name from its description. The service/group line keeps context that a bare "target missing" would lack. Users search by symptom or alert name, not metric expressions, so the query would add noise to the embedding.
- **Risk:** someone searching by a metric name won't match. Revisit if evals show it.
- **Simplification:** the whole `rules.yml` is one "document" (one `url`, one `doc_hash`), with `chunk_index` = rule order. Any upstream change re-embeds all 1,162 chunks, which is cheap at this size. Chosen because I haven't verified the site's per-service anchor URLs.

## D5. Chunking GitLab runbooks (2026-10-06)

- **Context:** 973 markdown files in the repo. Real files are long (median 6.4 KB, p90 19.5 KB, max 60 KB), with headings nested up to 4 levels, repeated leaf headings ("Grafana"), and `#` comment lines inside code blocks.
- **Choice:** split on headings, cap 1,500 chars (including prefix), 150 chars overlap, prefix each chunk with `docpath > heading path`. Headings inside code fences are ignored. Code blocks stay whole when they fit. Heading-only sections are skipped.
- **Overlap rule:** whole trailing lines if they fit in 150 chars, otherwise the last 150 chars cut at a word boundary. (First version used whole lines only, which silently gave zero overlap for single-line paragraphs. A test caught it.)
- **Subset:** only `docs/{patroni,redis,pgbouncer,kube,elastic}` (128 files, MIT), because they are generic infra topics (Postgres HA, Redis, connection pooling, Kubernetes, Elasticsearch). Most other folders are GitLab product internals.
- **Result on real data:** 1,794 chunks, median 749 chars, max 1,500.
- **Known limitations:** 113 chunks are under 200 chars, many are just a link under a heading. Some content is GitLab-specific (internal dashboard links). Neither is fixed yet. Revisit with evals (Phase 3) before spending effort on it.
- **Windows gotcha:** the repo contains filenames Windows cannot create (a `:` in a name, `aux.*`), so a normal clone fails. Files were extracted with `git show`.

## D6. Embedding model (2026-10-06)

- **Context:** Anthropic offers no embedding model. The `embedding` column must match the model's dimension.
- **Options:** Voyage `voyage-4-lite` (1024 dims, about $0.02 per 1M tokens), Voyage `voyage-4` (1024, about $0.06), OpenAI `text-embedding-3-small` (1536, $0.02).
- **Choice:** Voyage `voyage-4-lite`, 1024 dimensions.
- **Why:** Anthropic's recommended partner; the corpus (about 420k tokens, my estimate) costs almost nothing; 1024 matches the existing `vector(1024)` column, so no migration is needed. The "lite" variant is the cheapest and fastest. We can compare against `voyage-4` later using the evals.
- **Note:** prices came from secondary sources, model names and API shape from Voyage's official docs.

## D7. Call Voyage with plain `fetch`, no SDK (2026-10-11)

- **Context:** we need one HTTP call (`POST /v1/embeddings`).
- **Options:** Voyage's SDK vs a thin wrapper over `fetch`.
- **Choice:** thin wrapper in `src/ingestion/embed.ts`, with injectable `fetchFn` and `sleepFn` for tests.
- **Why:** nothing extra to install, the request and response are visible in 100 lines, and it is easy to test without the network. Matches the project goal of building the pipeline "raw".
- **Defaults:** batch size 64 (limit is 1,000), 5 retries with exponential backoff, `truncation: false` so over-long texts error instead of being silently cut.
- **Open issue:** the account has reduced rate limits (3 requests/minute, 10K tokens/minute) until a payment method is added. Needs a decision before ingesting all chunks.

## D8. What `doc_hash` covers, and what a document is (2026-10-13)

- **Context:** idempotent re-runs skip documents whose hash is already stored. A hash of file content alone misses changes to chunk settings or the embedding model, leaving stale chunks.
- **Options:** (a) hash content only; (b) hash content plus the settings that shape the output; (c) store settings in separate columns.
- **Choice:** (b). `doc_hash = SHA-256(chunker version; maxChars; overlap; model; dim, NUL, content)`.
- **Why:** one column, no schema change, and any setting change rebuilds everything automatically. Cost: a chunker _logic_ change needs a manual version bump.
- **Documents:** `rules.yml` is one document; each GitLab `.md` is one document with its url pinned to commit `92eb78a`. Prometheus url points at `master` (not pinned; the download did not record a commit).
- **Known issue:** four identical stub files in `docs/patroni/` produce duplicate near-empty chunks. Revisit with evals.

## D9. Write one document at a time, in one transaction

- **Context:** a re-run must be safe after a crash, and the skip check trusts `doc_hash`.
- **Options:** (a) update rows in place; (b) insert new rows, then delete old ones; (c) delete the document's rows and insert the new ones inside one transaction; (d) one giant transaction for all documents.
- **Choice:** (c), one document per transaction, embeddings computed before the transaction opens.
- **Why:** a partial write with the new hash would be skipped forever (silent data loss), so each document must be all-or-nothing. Per-document (not global) transactions mean a crash at document 80 keeps documents 1-79 and the next run resumes. Delete-and-insert handles files whose chunk count changes. One INSERT per chunk is simple and fast enough locally.
- **Trade-off:** embedding cost is wasted if the database write then fails; files deleted from `data/` are not pruned.

## D10. HNSW index with default settings

- **Context:** vector search scans every row without an index; fine at 2,956 rows, not at scale.
- **Options:** (a) no index (exact scan); (b) IVFFlat (clusters the vectors, must be trained on existing data, quality depends on the data at build time); (c) HNSW (graph, no training step, better recall/speed trade-off, bigger and slower to build).
- **Choice:** HNSW with `vector_cosine_ops`, default `m = 16`, `ef_construction = 64`, query-time `ef_search = 40` (default).
- **Why:** it can be created on a table that already has data without a training step, and it gave 99.9-100% recall at 1.5 ms versus 11.8 ms for the exact scan on our data. Defaults were enough, so no tuning (not gold-plating).
- **Trade-offs:** results are approximate; the index is 23 MB for about 12 MB of vectors; inserts become a bit slower. We keep the option of forcing an exact scan to measure recall.
- **Revisit:** recall should be re-measured with the real eval queries in Phase 3.

## D11. Eval set drafted with Claude from the source files, reviewed by me

- **Context:** I own the eval set, but on 2026-11-02 I asked Claude to draft it as a normal on-call engineer would write questions, and I reviewed it afterwards.
- **Risk:** bias. Claude built the system it is grading, and could write questions the system is known to answer.
- **Mitigation:** every expected answer was decided by reading the runbook headings and the alert names in `rules.yml`, NOT by running searches. Only four sample searches had been run earlier (for explaining the metrics), and those questions were not reused. Each entry has a `basis` line saying where in the sources the answer is, so I can check it. A validation script confirmed that every expected file exists and every alert name is real.
- **Design:** 44 questions: 10 exact alert names, 21 plain-language symptoms, 4 vague, 5 pasted alert text, 4 not in the corpus. Expected answers are marked at file level (runbooks) or alert-name level (alerts), never by chunk id, because chunk ids and numbers change on re-ingestion. A question may list several acceptable answers.
- **Unanswerable questions** (GitHub Actions, IIS, LDAP, VPN flapping) were checked as absent from both sources. They are scored separately from hit rate, because for them the right behaviour is "no confident answer".
- **Known limits:** 44 questions is small, so one question moves hit rate by about 2.3 points. File-level marking is lenient: it cannot tell whether the right SECTION of a large file was found. Several questions have more than one defensible answer; any expected list can be vetoed or extended.

## D12. Alert chunks do not count as correct answers for symptom and vague questions

- **Context:** in the baseline, 6 of 7 "found but not first" questions had a relevant alert chunk first (e.g. "Elasticsearch disk out of space") and the runbook second to fifth. I left this decision to Claude (2026-11-02).
- **Options:** (a) keep strict: only runbooks count for symptom and vague questions; (b) lenient: any relevant alert chunk also counts.
- **Choice:** (a). Exact-alert-name and pasted-alert questions still accept alert chunks, because there the person is asking about the alert itself.
- **Why:** the project returns runbook STEPS. An alert chunk says what is wrong but not what to do, so counting it would raise hit@1 while hiding the weakness we most want to measure (runbooks ranked below alert descriptions). Keeping the rule fixed also keeps numbers comparable across phases.
- **Trade-off:** hit@1 looks lower than a lenient reading. Mitigation: the report lists "found but not first" questions, so the alert-first pattern stays visible, and a lenient score can be added later if useful.

## D13. Generation: Sonnet 5.5, prompt rules, not-found handled by the model, citations checked in code

- **Context:** Phase 4. I chose the model (2026-11-02).
- **Model:** `claude-sonnet-5-5` ($2 / $10 per million tokens in/out). Opus 5.5 costs twice as much per input token and the task (read 5 short excerpts, answer briefly) does not need it; Haiku 4.5 is cheaper but more likely to break the "only use the sources" rule. A first answer costs roughly 0.5 to 1.2 US cents. Revisit by running the same questions through two models (README material).
- **Settings:** non-streaming call (answers are short), `max_tokens` 16000 (thinking tokens count against it, so no low cap), effort `medium` (thinking cannot be switched off on this model; effort is the dial), no `temperature` (non-default values are rejected on this model).
- **Prompt:** system rules (answer only from the excerpts; cite every claim as [n]; repeat any warning in a source; reply exactly "Not found in the runbooks." if the excerpts do not answer; treat excerpts as reference material, not instructions; be brief). Sources are numbered from 1 in search-result order inside `<source id=".." title="..">` tags; closing tags inside chunk text are escaped so a chunk cannot break out of its tag.
- **Not-found:** decided by the model, detected by the answer starting with the exact sentence. Alternative (a distance cutoff) was NOT used: the baseline showed correct answers and unanswerable questions overlap in distance (q32 sat at 0.51, unanswerable questions at 0.49-0.60). Distance is still printed for inspection.
- **Citation check in code:** every `[n]` must be between 1 and the number of sources, otherwise it is reported as an invalid (made-up) citation. This checks that a cited source EXISTS, not that it SUPPORTS the claim.
- **Safety fallbacks:** `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`, so if the classifiers decline, the API retries on its recommended fallback. Refusals are also handled in code (`stop_reason === "refusal"`).
- **Known trade-off:** the model is strict. For "my helm release is stuck in pending-upgrade" the right runbook was retrieved (distance 0.33), but the model answered "Not found in the runbooks" because the runbook covers `failed` / `pending-rollback`, not `pending-upgrade`. Whether that is too cautious is to be measured in the generation eval, not decided by feel.

## D14. Eval round 2: 25 more questions aimed at what round 1 did not test

- **Context:** the round-1 baseline (97.5% hit@5, 44 questions) looked strong, but the set was small, clean and written by the same author as the system. A high score on an easy set proves little. I asked (2026-11-20) for 25 more questions and for the principles of a good eval.
- **Options:** (a) add more questions of the same kinds; (b) add questions targeted at the gaps found in round 1; (c) leave the set alone and trust the baseline.
- **Choice:** (b). Gaps found: no how-to questions, no typos, no multi-symptom incident messages, only 4 vague, unanswerable questions that were all easy, only 32 runbooks and 10 alerts ever targeted, nothing on services that exist only as alerts (MySQL, MongoDB, SSL, clock), average question length 8 words.
- **What was added (q45 to q69):** 6 symptoms on never-targeted runbooks, 6 how-to, 2 paraphrase, 4 alert-only, 1 pasted alert, 1 messy, 1 multi-symptom, 1 vague, 3 near-miss unanswerable (EKS/Karpenter, DynamoDB, OpenShift). Result: 69 questions, 62 answerable, 7 unanswerable; 49 runbooks and 18 alerts targeted.
- **Bias mitigation (same as D11):** answer keys decided by reading the runbook headings and `rules.yml`; no searches were run. A script confirmed every expected file exists and every alert name is real. "Absent from the corpus" was verified by searching the raw files: two candidates (Splunk, major version upgrade) were dropped because they do appear.
- **Rules kept from D12:** where a runbook exists, only runbooks count for symptom and vague questions. For topics with only alerts (MySQL, MongoDB, SSL, clock), alerts count, because there is nothing else to return.
- **Trade-offs:** still one author, still file-level marking, per-category groups of 1 to 4 questions are too small for percentages. Lenient keys on q65 and q66 (any of several answers counts) make those easier, on purpose, because the questions are genuinely ambiguous.
- **Reporting:** the original 44 results stay in `EVAL_RESULTS.md` as the historical baseline; the next run reports both "original 44" and "all 69", so numbers stay comparable.
- **Revisit:** after the first full run, read every failed question to decide whether the SYSTEM or the QUESTION was wrong, and veto any unnatural question.

## D15. Generation eval: combined grading, Opus 5.5 judge, 10 hand reviews

- **Context:** the retrieval eval only checks that the right source is in the top 5. Phase 4 needs to know whether the WRITTEN answer is faithful to its sources, complete, cited correctly, and honest about "not found". The code only checks that `[n]` points at a real source, not that the source supports the claim (D13).
- **Options:** (a) rules in code only; (b) an LLM judge only; (c) rules + LLM judge + a human sample; (d) human review only.
- **Choice (2026-11-20, mine): (c) combined.**
  - **Rules on all 69 questions:** citations well-formed, no truncation, no refusal, "Not found" appears on the 7 unanswerable questions and (as a failure) on answerable ones.
  - **LLM judge on the 62 answerable questions:** faithfulness (is every claim supported by the cited source?) and completeness (key steps and warnings present?).
  - **Judge model: Claude Opus 5.5.** Answers are written by Sonnet 5.5. A stronger model as judge, and a different model from the writer.
  - **Human review: 10 answers**, picked to include the judge's lowest and highest scores, so I can check whether the judge itself can be trusted.
- **Why not the writer as its own judge:** the same model shares the writer's blind spots and tends to rate its own style and plausible-sounding claims favourably (self-preference bias). A stronger judge helps but does not remove the problem, which is why a human sample stays in the design.
- **Trade-offs:** the judge has its own errors and costs money (estimate before running); 10 human reviews is a small sample, so it calibrates the judge rather than proving a number; the judge sees the same chunks the writer saw, so it cannot detect a retrieval failure (the retrieval eval covers that).
- **Rubric (2026-11-20, details in LEARNING_NOTES section 28):**
  - Grade GROUNDEDNESS (is each claim supported by the sources we gave), not general correctness.
  - Rules in code on all 69: not truncated, not refused, citations well-formed, no wrong refusal (only when the expected source was retrieved), unanswerable questions start with the exact not-found sentence.
  - Judge on the 62 answerable: structured JSON with a claim list (`SUPPORTED` / `MISCITED` / `UNSUPPORTED` / `CONTRADICTED`) and an omissions list (`warning` / `step`); faithfulness, citation accuracy, completeness and PASS are COMPUTED IN CODE from it, so the judge never hands out a bare score and every verdict can be audited.
  - Human: 10 answers graded blind (before seeing the judge's verdict); report agreement and every disagreement.
- **Cost estimate:** about $4 per full run (range $3 to $7): answers about $0.83 (Sonnet 5.5), judge about $3.30 (Opus 5.5 at $4 / $20 per million; its output tokens are the main uncertainty). Answers are saved so a judge-only re-run costs about $3.30. Plan: pilot on 3 questions to measure real judge tokens, then decide the full run.
- **Status:** rules layer built and run on all 69 questions (2026-11-21, see D16). Judge built and piloted on 3 answers (2026-11-24): $0.12 for 3 calls, about $0.04 per call measured, so the full run of 57 judgeable answers (bare "Not found" replies and refusals are skipped) should cost about $2.50. Added beyond the rubric: the code verifies each judge quote appears in the source the judge named, to catch invented evidence. Planted-error test done (2026-11-25, `src/eval/plant.ts`, `npm run eval:plant`): on q18 the judge caught an invented step, an opposite claim and a dropped warning, labelled a wrong citation MISCITED, and passed the untouched control (5 of 5, $0.34, see EVAL_RESULTS). Not yet done: the full run and your 10 blind hand reviews. **Open question for you:** a MISCITED claim does not fail PASS (the wrong-citation plant PASSED with 3 MISCITED). Should a wrong citation number fail the answer? For an on-call engineer who clicks `[2]` to verify and lands on the wrong text, probably yes, but it would make PASS stricter than "is it grounded".

## D15 addendum (2026-11-25): a MISCITED claim does not fail PASS

- **Context:** the planted-error test showed a wrong citation number (3 MISCITED claims) still PASSES, because PASS looks at UNSUPPORTED, CONTRADICTED, completeness, the free rules and fake quotes (D17), not MISCITED.
- **Choice (mine): keep it that way.** PASS means "every claim is grounded somewhere in the 5 chunks", not "every claim carries the right `[n]`".
- **Why / trade-off:** the content is still true to the runbook, so the answer is not dangerous; citation accuracy (SUPPORTED / (SUPPORTED + MISCITED)) is reported beside PASS so wrong numbers stay visible. The cost: an engineer who clicks the wrong `[n]` still lands on unrelated text, and a high PASS rate can hide a lower citation accuracy. Always read the two numbers together.

## D15 addendum 2 (2026-11-25): the 10 blind hand reviews, how they were picked

- **Pack:** `eval/review/review-pack.md` (question, the 5 sources, the answer, a grade form; no judge output). **Answer key:** `eval/review/answer-key.json` (which question each item is, why it was picked, the judge's verdict). The key is not to be opened before all 10 are graded.
- **Mix (my picks as Claude, approved by you):** 4 answers the judge FAILED, 4 it PASSED, 2 unanswerable near-misses where the reply was "Not found". Order shuffled with a fixed seed so position does not reveal the group.
- **Why this mix:** the judge FAILs test false alarms (including one that failed only on a quote check, D17). The PASSes were chosen for the dangerous direction, a judge approving something wrong: long answers, risky topics, and sources full of warning words, because 0 missed warnings in 55 answers could mean "writer is careful" or "judge is lenient". The unanswerable pair tests whether "Not found" was really right when a plausible chunk was retrieved.
- **Grading rules given to you:** the judge's own definitions (SUPPORTED / MISCITED / UNSUPPORTED / CONTRADICTED, missing warning or key step), groundedness not general truth, MISCITED does not fail, so that agreement compares like with like.
- **Limits, stated honestly:** (1) you had already seen the list of failing question ids in my run summary, so the blindness is partial for those 4; the shuffle and the PASS items reduce, not remove, the anchoring. (2) I picked the cases, so this is a targeted calibration set, not a random sample: agreement on it does NOT estimate the judge's accuracy across all 57. (3) 10 items can show whether the judge is badly off, not a precise rate.
- **What we do with it:** report agreement (verdict matches) and write up every disagreement: who was right, and whether the judge, the rubric or the human reading was at fault.

## D16. Rule `noWrongRefusal` counts only RUNBOOK hits, not alert-chunk hits

- **Context:** the first run of the rules layer (2026-11-21) flagged 8 "wrong refusals" (the model said "Not found" although retrieval had found an expected source). Reading them, 6 were alert-only hits: the retrieved chunk described an alert ("MySQL replication lag on instance") but contained no fix steps, so "Not found" for a "what do I do" question is defensible. 2 (q15, q25) were the right file but the wrong section.
- **Options:** (a) keep the rule as first written (any expected source retrieved); (b) apply it only when an expected RUNBOOK chunk was retrieved.
- **Choice (2026-11-21, mine): (b).**
- **Why:** it follows D12: alert chunks carry no steps, so retrieving one does not mean an answer was possible. Counting it would blame the writer for a gap in the corpus.
- **Honesty note:** the change was made AFTER seeing the results, which risks looking like moving the goalposts. Mitigations: the reason is the same principle as D12, the original figure stays on record (8 flagged: q15, q25, q33, q38, q39, q59, q60, q61), and the same saved answers were re-scored, not re-run. Result under the new rule: 3 flagged (q15, q25, q39); the rule now applies to 49 questions instead of 61.
- **Trade-off:** the rule is now silent on questions whose only corpus coverage is an alert description. Whether "Not found." alone is a good reply for those (for example the pasted `KubePodCrashLooping`) is a separate product question, not decided: "this alert means X, no runbook exists" might serve an on-call engineer better.
- **Tooling:** `npm run eval:gen -- --from <file.json>` re-applies the rules to a saved run without any API call, so rule changes cost nothing to evaluate.

## D17. A judge quote that is not in the source fails the answer

- **Context:** for every claim the judge gives a label plus a verbatim quote as proof. Code checks the quote exists in the source the judge named (`quoteIsInSource`). In the first version a missing quote only raised the counter `unverifiedQuotes`; the claim kept its label (for example SUPPORTED) and `pass` ignored the counter. So an answer could pass on evidence the judge invented, with the only warning being a number nobody had to read.
- **Options:** (a) keep it as a warning counter for a human to read; (b) make `unverifiedQuotes > 0` fail the answer.
- **Choice (2026-11-24, mine): (b).**
- **Why:** a label with fake proof is an unearned label. The safe reading is "we cannot trust this verdict", not "probably fine". It also makes the failure visible in the PASS count, not only in a side counter.
- **Trade-off:** a correct answer can now FAIL because the judge copied its quote badly (a typo, or a paraphrase inside the quote), which makes the FAIL count pessimistic. Whitespace and case are already normalised. If the full run shows many such cases, read them and decide whether the quote rule is too strict. This is the same "read the failures" step as D11 and D16.
- **Not changed:** the claim's own label and faithfulness are still counted as the judge gave them. Only `pass` changed. Faithfulness and citation accuracy can therefore still look better than the evidence deserves when a quote is fake; `unverifiedQuotes` stays reported beside them.

## D18. Full-text search: OR query, built-in `ts_rank`, no weights (2026-11-27)

- **Context:** Phase 5 adds keyword search next to vector search. The `tsv` column (`to_tsvector('english', text)`, generated) already exists, so no migration was needed. The questions to settle were how to turn a long natural-language question into a query and how to score matches.
- **Options for the query:** (a) `websearch_to_tsquery` as it is: every word joined with `&` (ALL must match); (b) the same query with `&` replaced by `|` (ANY may match), then rank. **Options for scoring:** `ts_rank` (built in, counts matches), `ts_rank_cd` (also rewards words close together), BM25 (weighs rare words more; not built into Postgres, needs an extension).
- **Choice (2026-11-27):** (b) with plain `ts_rank`, default length normalisation, ties broken by `id`. Implemented as `searchFullText` in `src/query/search.ts`.
- **Why:** measured on the real corpus, the AND form of q14 ("applications can't get a connection from pgbouncer, the pool looks full") returned **0** chunks; the OR form returned 5 sensible ones. A real alert question always has at least one word that a chunk lacks, so AND is useless. `ts_rank` is the simplest thing that works and needs nothing new.
- **Trade-offs, seen in the real data:** (1) `ts_rank` does not know that `pgbouncer` is rarer than `pool`; BM25 would. (2) It cannot link synonyms ("RAM" and "memory" share no stem). (3) Exact alert names tie: `PatroniDeadlocksDetected` returned 5 chunks of the same file at an identical 0.0608, because every chunk of that file contains the name in its heading path. The order inside a tie is then just `id`. (4) Tokenising: `HostOutOfMemory` stays ONE token (`hostoutofmemori`), so the question "host out of memory" does not match it by words; `node_memory_MemAvailable_bytes` is split at the underscores (`node`, `memori`, `memavail`, `byte`).
- **Revisit if:** the hybrid eval shows keyword results are weak. Then try BM25 or `ts_rank_cd` as a separate measured experiment, not before.
- **Next (5b):** fuse the two rankings with RRF, equal weights, constant 60 (to be recorded as its own decision when built). Weights are not tuned: with 62 answerable questions, one question moves hit rate by 1.6 points, so tuning would fit noise.

## D19. Hybrid search: RRF over the top 20 of each searcher, equal weights, constant 60 (2026-11-27)

- **Context:** Phase 5 step 5b. Two rankings (vector, full-text) must become one. Their scores cannot be compared directly: cosine distance is smaller-is-better and runs roughly 0 to 2; `ts_rank` is bigger-is-better with a query-dependent scale.
- **Options:** (a) normalise both scores and add them; (b) Reciprocal Rank Fusion (RRF), which uses only each chunk's position in each list: points = 1 / (constant + position), summed over the lists. **Parameters to choose:** the constant, per-searcher weights, how many candidates each searcher contributes, the tie-break.
- **Choice (2026-11-27):** (b); constant 60 (the common default); equal weights; candidate depth 20 per searcher, fused, then cut to K=5; ties broken by position in the vector list first, then the text list, then the chunk key `url#chunk_index` (chunks are unique by `(url, chunk_index)`). Code: `fuseRRF` (pure, `src/query/fusion.ts`) and `hybridSearch` (`src/query/hybrid.ts`).
- **Why:** (b) needs no score normalisation, so a change in either searcher's scale cannot silently break the fusion. Constant 60 keeps the gap between positions small, so appearing in both lists is worth far more than being first in one. Depth 20, not 5: with only the top 5 of each list, a chunk the keyword search ranked 6th (often only because of a tie broken by row id) could never reach the fusion. Weights are NOT tuned: with 62 answerable questions, one question moves hit rate by 1.6 points, so tuning would fit noise.
- **Trade-offs:** RRF rewards agreement, so it cannot know we prefer runbook chunks to alert chunks; if both lists rank an alert chunk high, fusion pushes it higher. Depth 20 is a guess, not measured; a wider pool catches more but adds weak candidates. A chunk found only by keywords has no cosine distance (`distance: null`), so code that prints or thresholds on distance needs to cope (5c). The "not found" distance idea from Phase 4 does not carry over to hybrid scores: an RRF score says nothing about how good a match is, only how the chunk ranked.
- **Not yet measured:** 5c re-runs the eval and compares with the baseline (hit@1 80.6%, hit@5 98.4%, MRR 0.876). Depth, constant and weights are separate experiments to run one at a time.

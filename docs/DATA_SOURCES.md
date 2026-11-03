# Data Sources

| Source                    | URL                                                 | License                                    | Attribution                                                  | Date fetched                                                                                                                | Status                   |
| ------------------------- | --------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| awesome-prometheus-alerts | https://github.com/samber/awesome-prometheus-alerts | CC BY 4.0 (rules/content); MIT (site code) | Required: credit the project, link the license, note changes | 2026-10-05, pinned to commit `0fbd084` (`_data/rules.yml`, saved in `data/awesome-prometheus-alerts/`)                      | chosen                   |
| GitLab runbooks           | https://gitlab.com/gitlab-com/runbooks              | MIT                                        | Keep copyright and license notice                            | 2026-10-06, commit `92eb78a`, folders `docs/{patroni,redis,pgbouncer,kube,elastic}` (128 files), in `data/gitlab-runbooks/` | chosen (filtered subset) |

## Considered and rejected

- **danluu/post-mortems**: no license declared; it only links to third-party posts that keep their own copyright.
- **kubernetes-mixin runbook.md** (Apache 2.0): entries are 3-4 lines linking elsewhere. Optional later.

License verified 2026-10-05 from each repo's LICENSE file / GitHub API.

## Recreating `data/`

`data/` is not committed (it is gitignored). `npm run data:fetch` downloads both sources at the pinned commits above and rebuilds the folder in a few seconds; the result is byte-identical to the snapshot the eval numbers were measured on. It uses plain HTTPS rather than `git clone`, because the GitLab repository contains file names that Windows cannot hold (colons, `aux.*`).

## Changes made to the data

- **awesome-prometheus-alerts (CC BY 4.0):** split into one chunk per alert rule. The PromQL query field is left out of the embedded text. Nothing else is altered.
- **GitLab runbooks (MIT):** markdown files only, from five folders (`patroni`, `redis`, `pgbouncer`, `kube`, `elastic`), split by heading with a size cap and overlap. Text is otherwise unchanged; a heading path is prepended to each chunk.

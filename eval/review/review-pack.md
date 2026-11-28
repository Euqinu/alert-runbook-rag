# Blind review pack (generation eval)

You are grading 10 answers by hand. **Write your verdict for each item BEFORE you look at anything the judge said.**
Do NOT open: `eval/review/answer-key.json`, `eval/runs/judge-*.json`, `eval/runs/plant-*.json`, or the judge sections in `docs/EVAL_RESULTS.md`.

## What to do for each item

Read the 5 numbered sources and the answer. The answer was written ONLY from those sources, and cites them as [1] to [5]. You are grading **groundedness**, the same thing the judge grades, so the comparison is fair:

- Split the answer into steps / statements. For each one decide:
  - **SUPPORTED**: a source it cited says it (a faithful paraphrase counts).
  - **MISCITED**: a source says it, but not the one(s) cited. (Does NOT fail the answer, D15 addendum.)
  - **UNSUPPORTED**: no source says it, or it adds a material detail (a command, number, threshold, step) that no source contains. Ignore what YOU know: advice that is true in general but absent from the sources is UNSUPPORTED.
  - **CONTRADICTED**: a source says the opposite.
- **Missing**: does a source that bears on the question contain a *warning* ("do not", "never", "must not") or a *key step* (the procedure cannot work without it) that the answer left out? A missing minor detail does not matter.
- **Verdict = FAIL** if there is any UNSUPPORTED or CONTRADICTED claim, or a missing warning or key step. Otherwise **PASS**.
- If the answer is just "Not found in the runbooks.": decide whether that is the right reply, i.e. whether the 5 sources really contain no answer. Verdict = CORRECT or WRONG (the sources did answer it).

Fill in the lines under "YOUR GRADE" in this file. Short is fine: step numbers and a few words.

---

## R01

**Question:** a table and its indexes are badly bloated, how can I shrink them without a long exclusive lock

### Sources

**Source [1]** — patroni/pg_repack.md > Pg_repack using gitlab-pgrepack > Why pg_repack?

~~~~text
patroni/pg_repack.md > Pg_repack using gitlab-pgrepack > Why pg_repack?

`VACUUM FULL` is a standard command that can be used to get rid of bloat. But, as opposed to regular `VACUUM` (executed either by autovacuum or manually), `VACUUM FULL` uses a long-lasting exclusive lock on the table (basically, recreating the table and its indexes), blocking all the queries to the table and impacting performance. `Pg_repack` uses an approach that requires short-lived locks, being obtained gracefully (with multiple attempts with `statement_timeout` gradually growing from `100ms` to `1000ms`), suitable for databases with high and concurrent activity.
~~~~

**Source [2]** — patroni/pg_repack.md > Pg_repack using gitlab-pgrepack > What to repack

~~~~text
patroni/pg_repack.md > Pg_repack using gitlab-pgrepack > What to repack

Bloat cannot be seen in exact numbers without expensive reading of database files, but we can have light checks providing estimates (which may be off up to dozens of percent in some cases, however). Usually, we consider bloat level of 20-30% as "normal", 50-60% as "significant", 80-90% as "high", and >90% as "extremely high".

Generally, we should start considering repacking indexes when the estimated bloat exceeds 50%, and definitely need to repack when it is greater than 60%. For tables, it depends: if we know that soon more data will be inserted to the table, we can skip repacking tables with a high level of bloat (two reasons: repacking of tables is lock-heavy, and also high table bloat usually doesn't affect performance directly), and we definitely should consider repacking tables with estimated bloat 90% and higher.

Of course, the repacking of tiny objects (such as tables or indexes which size is a few MiB) may not make sense and can be safely skipped.
~~~~

**Source [3]** — patroni/pg_repack.md > Pg_repack using gitlab-pgrepack > Get objects that need to be repacked

~~~~text
patroni/pg_repack.md > Pg_repack using gitlab-pgrepack > Get objects that need to be repacked

gitlab-pgrepack repack --type=tables --objects=public.geo_event_log
gitlab-pgrepack repack --type=tables --objects=public.ci_triggers
gitlab-pgrepack repack --type=tables --objects=public.pages_domains
gitlab-pgrepack repack --type=tables --objects=public.geo_repository_updated_events
gitlab-pgrepack repack --type=tables --objects=public.suggestions
gitlab-pgrepack repack --type=tables --objects=public.geo_node_statuses
Expected cleanup of 311.34 MiB of bloat.

INDEX bloat:
44.90 GiB of bloat (31.2 % ratio of total size)
Recommended repacking for index bloat:
gitlab-pgrepack repack --type=btrees --objects=public.index_user_highest_roles_on_user_id_and_highest_access_level
gitlab-pgrepack repack --type=btrees --objects=public.user_highest_roles_pkey
gitlab-pgrepack repack --type=btrees --objects=public.index_geo_reset_checksum_events_on_project_id
gitlab-pgrepack repack --type=btrees --objects=public.index_geo_event_log_on_container_repository_updated_event_id
gitlab-pgrepack repack --type=btrees --objects=public.geo_event_log_pkey
gitlab-pgrepack repack --type=btrees --objects=public.geo_reset_checksum_events_pkey
gitlab-pgrepack repack --type=btrees --objects=public.index_geo_event_log_on_reset_checksum_event_id
gitlab-pgrepack repack --type=btrees --objects=public.index_merge_request_diffs_on_merge_request_id_and_id_partial
~~~~

**Source [4]** — patroni/postgres-automatic-reindexing.md > GitLab application-side reindexing > What is reindexing?

~~~~text
patroni/postgres-automatic-reindexing.md > GitLab application-side reindexing > What is reindexing?

indexes, i.e. it does not support primary key indexes, unique indexes, expression indexes, etc. However, the majority of indexes is supported.

From a workflow perspective, when the reindexing kicks off, it estimates index bloat for all supported indexes using a heuristic. It then chooses the top N indexes by their bloat level and starts to recreate those. The recreating phase is similar to what `pg_repack` does under the hoods:

1. It creates a new temporary index on the side
1. Then, it performs a renaming operation to swap indexes

(1) is low-risk in terms of locks but incurs additional disk IO to create the replacement index. (2) needs a elevated lock on the table to perform the renaming operations. We have guards in place, so this does not end up stalling the site for a longer period of time. If this guard doesn't work out, the process is cancelled and cleaned up automatically (so we are not forcing the lock). It will be retried upon the next invocation.
~~~~

**Source [5]** — patroni/pg_repack.md > Pg_repack using gitlab-pgrepack > What is bloat?

~~~~text
patroni/pg_repack.md > Pg_repack using gitlab-pgrepack > What is bloat?

Bloat can be seen as the "remains" of UPDATE and DELETE activity. It is important to distinguish the concepts of "dead tuples" and "bloat". When a row is updated or deleted, PostgreSQL creates new physical versions of rows – called "tuples". After transaction finishes, old tuples are marked as "dead". Accumulation of dead tuples (caused by a massive operation or temporary autovacuum's inability to clean up dead tuples promptly) leads to the situation, when autovacuum cleans many dead tuples at once, leaving significant "gaps" in physical layout (empty space in pages) – these gaps is what we call "bloat".

Both tables and indexes can be bloated. Two negative effects of the growing bloat are:

1. excessive disk space usage,
1. performance degradation (usually, high levels of index bloat are more dangerous for performance).
~~~~

### Answer to grade

1. Don't use `VACUUM FULL`. It holds a long-lasting exclusive lock while it recreates the table and its indexes, blocking all queries to the table and hurting performance [1].

2. Use `pg_repack` via `gitlab-pgrepack`. It takes only short-lived locks, acquired gracefully with multiple attempts and `statement_timeout` growing from 100ms to 1000ms [1].

3. Check the estimated bloat first (estimates can be off by dozens of percent) [2]:
   - Indexes: consider repacking above 50% bloat, and definitely repack above 60% [2].
   - Tables: definitely consider repacking at 90% or higher [2]. If more data will soon be inserted, you can skip repacking a highly bloated table. Table repacking is lock-heavy, and high table bloat usually doesn't directly affect performance [2].
   - Tiny objects (a few MiB) can safely be skipped [2].

4. Run the repack per object using this syntax [3]:
   - Tables: `gitlab-pgrepack repack --type=tables --objects=public.<table_name>` [3]
   - Indexes: `gitlab-pgrepack repack --type=btrees --objects=public.<index_name>` [3]

5. Prioritize the indexes, since high index bloat is usually more dangerous for performance [5].

Missing from the excerpts: the exact command to list the objects that need repacking, and any prerequisites or rollback steps for `gitlab-pgrepack`.

Related: GitLab's automatic reindexing recreates supported indexes by building a new index and swapping it in. It does not support primary key, unique, or expression indexes [4].

### YOUR GRADE (R01)

- Verdict (PASS / FAIL): 
- UNSUPPORTED or CONTRADICTED steps (step number + one line why): 
- MISCITED steps (step number, which source is right): 
- Missing warning or key step (which source says it): 
- Notes: 

---

## R02

**Question:** CPU on the primary database node is saturated, how do I find which queries are responsible

### Sources

**Source [1]** — patroni/primary_db_node_cpu_saturation.md > Primary Database Node CPU Saturation Analysis > How to identify the root cause? > Total number of calls

~~~~text
patroni/primary_db_node_cpu_saturation.md > Primary Database Node CPU Saturation Analysis > How to identify the root cause? > Total number of calls

To find the top 10 statements by number of calls use the following PromQL query:

```
topk(10,
  sum by (queryid) (
    rate(pg_stat_statements_calls{env="gprd", type="patroni"}[1m]) and on (instance) pg_replication_is_replica == 0
  )
)
```

- Go to [Mimir](https://dashboards.gitlab.net/goto/3TZu89ONg?orgId=1).
- For the `ci` database change the `type` label to `patroni-ci`.
- Adjust time range to 15 minutes before and after the alert.
- On the graph, click _"Show all"_ so that all series are rendered.
- Look for any statement(s) that stand out.
~~~~

**Source [2]** — patroni/primary_db_node_cpu_saturation.md > Primary Database Node CPU Saturation Analysis > How to identify the root cause? > Map queryid to SQL

~~~~text
patroni/primary_db_node_cpu_saturation.md > Primary Database Node CPU Saturation Analysis > How to identify the root cause? > Map queryid to SQL

To find the normalized SQL for given queryid, follow the [mapping docs](mapping_statements.md). Usually searching the logs is enough:

- Go to [Kibana](https://log.gprd.gitlab.net/app/r/s/tYFB8).
- Update the filter and set the queryid.
- If needed increase the time range.
~~~~

**Source [3]** — patroni/primary_db_node_cpu_saturation.md > Primary Database Node CPU Saturation Analysis > How to identify the root cause? > Total execution time

~~~~text
patroni/primary_db_node_cpu_saturation.md > Primary Database Node CPU Saturation Analysis > How to identify the root cause? > Total execution time

To find the top 10 statements by execution time use the following PromQL query:

```
topk(10,
  sum by (queryid) (
    rate(pg_stat_kcache_exec_total_time{env="gprd", type="patroni"}[1m]) and on (instance) pg_replication_is_replica == 0
  )
)
```

- Go to [Mimir](https://dashboards.gitlab.net/goto/NGQZUrdNg?orgId=1).
- For the `ci` database change the `type` label to `patroni-ci`.
- Adjust time range to 15 minutes before and after the alert.
- On the graph, click _"Show all"_ so that all series are rendered.
- Look for any statement(s) that stand out. In the example bellow we can see that the statement with queryid `5155022932036490076` spiked at around 18:28:00.
    ![execution time spike](img/cpu-saturation-pg_stat_kcache_exec_total_time.png)
~~~~

**Source [4]** — patroni/primary_db_node_cpu_saturation.md > Primary Database Node CPU Saturation Analysis > How to identify the root cause? > Total plan time

~~~~text
patroni/primary_db_node_cpu_saturation.md > Primary Database Node CPU Saturation Analysis > How to identify the root cause? > Total plan time

To find the top 10 statements by plan time use the following PromQL query:

```
topk(10,
  sum by (queryid) (
    rate(pg_stat_statements_plan_seconds_total{env="gprd", type="patroni"}[1m]) and on (instance) pg_replication_is_replica == 0
  )
)
```

- Go to [Mimir](https://dashboards.gitlab.net/goto/-rLPU9ONg?orgId=1).
- For the `ci` database change the `type` label to `patroni-ci`.
- Adjust time range to 15 minutes before and after the alert.
- On the graph, click _"Show all"_ so that all series are rendered.
- Look for any statement(s) that stand out.
~~~~

**Source [5]** — patroni/primary_db_node_cpu_saturation.md > Primary Database Node CPU Saturation Analysis > How to identify the root cause? > Other sources

~~~~text
patroni/primary_db_node_cpu_saturation.md > Primary Database Node CPU Saturation Analysis > How to identify the root cause? > Other sources

The following dashboards may be also useful:

- [Postgres aggregated query performance analysis](https://dashboards.gitlab.net/goto/EhpSQ9dNR?orgId=1)
- [Postgres single query performance analysis](https://dashboards.gitlab.net/goto/3o2pw9ONg?orgId=1)

To use these dashboards filter by:

- environment: `gprd`.
- type: `patroni` for the `main` database, `patroni-ci` for the `ci` database.
- fqdn: the current primary node for the database. The primary can change regularly.
To see which server is the current primary view the
[PostgreSQL Replication Overview](https://dashboards.gitlab.net/goto/fu0fQrdNR?orgId=1) dashboard.
- queryid: for single qury analysis use the respective value.'
~~~~

### Answer to grade

1. Pick a metric and run its PromQL query in Mimir. The runbook gives three top-10 views:
   - By number of calls: `pg_stat_statements_calls` [1]
   - By execution time: `pg_stat_kcache_exec_total_time` [3]
   - By plan time: `pg_stat_statements_plan_seconds_total` [4]

   Each query is a `topk(10, sum by (queryid) (rate(...[1m]) and on (instance) pg_replication_is_replica == 0))` with `env="gprd", type="patroni"`, which limits results to the primary [1][3][4].

2. For the `ci` database, change the `type` label to `patroni-ci` [1][3][4].

3. Set the time range to 15 minutes before and after the alert [1][3][4].

4. Click "Show all" on the graph so all series render, then look for statements that stand out, such as a spike [1][3][4].

5. Map the suspicious `queryid` to SQL. Searching the logs is usually enough [2]:
   - Go to Kibana and set the filter to the queryid [2].
   - Increase the time range if needed [2].
   - Otherwise, follow the mapping docs (`mapping_statements.md`) [2].

6. Optionally, use the "Postgres aggregated query performance analysis" and "Postgres single query performance analysis" dashboards [5]. Filter by:
   - environment `gprd` [5]
   - type `patroni` (main) or `patroni-ci` (ci) [5]
   - fqdn of the current primary, which can change regularly. Check the PostgreSQL Replication Overview dashboard to see which server it is [5]
   - queryid, for single-query analysis [5]

### YOUR GRADE (R02)

- Verdict (PASS / FAIL): 
- UNSUPPORTED or CONTRADICTED steps (step number + one line why): 
- MISCITED steps (step number, which source is right): 
- Missing warning or key step (which source says it): 
- Notes: 

---

## R03

**Question:** queries are blocked waiting on locks, how do I see what is blocking them and cancel it

### Sources

**Source [1]** — patroni/postgresql-locking.md > About Locking and cancelling/terminating queries > How to see locking and locked activity

~~~~text
patroni/postgresql-locking.md > About Locking and cancelling/terminating queries > How to see locking and locked activity

When troubleshooting blocked queries, two internal sources of information comes in handy:

The [pg_stat_activity view](https://www.postgresql.org/docs/11/monitoring-stats.html#PG-STAT-ACTIVITY-VIEW), wich gives information about current activity, where is connected from, wich query is executing, and the

[pg_locks system catalog](https://www.postgresql.org/docs/11/view-pg-locks.html), that provides information current locking activity, wich pid it belongs to, if the lock where granted (or is waiting), and so on.

For demostration porpouses, we will create an artificial lock using the [LOCK](https://www.postgresql.org/docs/11/sql-lock.html) command:

Session :one: will issue a LOCK statement (wich implement a ACCESS EXCLUSIVE lock, wich conflicts even with SELECT operations:

```SQL
locktest=# begin;
BEGIN
locktest=# lock TABLE mytable ;
LOCK TABLE

```

Then session :two: try to access the same data:

```sql

locktest=# select count(*) from mytable;

```

That SELECT will wait until LOCK is released.  OK, how can we tell what is blocking what? We can use this snippet posted by Nikolay Samokhvalov, that combines the information from `pg_stat_activity` and `pg_locks`:
```sql
with recursive l as (
  select
    pid, locktype, granted,
~~~~

**Source [2]** — patroni/postgresql-locking.md > About Locking and cancelling/terminating queries > How to see locking and locked activity

~~~~text
patroni/postgresql-locking.md > About Locking and cancelling/terminating queries > How to see locking and locked activity

from leads o
  where
    (cycle and not exists (select from leads i where i.locker=any(o.track) and (i.lvl>o.lvl or i.q<o.q)))
    or (not cycle and not exists (select from pairs where waiter=o.locker) and not exists (select from leads i where i.locker=o.locker and i.lvl>o.lvl))
  union all
  select w.waiter pid,tree.pid,tree.root,case when w.waiter=any(tree.dl) then tree.dl end,w.obj,tree.lvl+1,tree.path||'.'||w.waiter,all_pids || array_agg(w.waiter) over ()
  from tree
  join pairs w on tree.pid=w.locker and not w.waiter = any (all_pids)
)
select (clock_timestamp() - a.xact_start)::interval(0) as transaction_age,
  (clock_timestamp() - a.state_change)::interval(0) as change_age,
  a.datname,
  a.usename,
  a.client_addr,
  tree.pid,
  a.wait_event_type,
  a.wait_event,
  pg_blocking_pids(tree.pid) blocked_by_pids,
  replace(a.state, 'idle in transaction', 'idletx') state,
  lvl,
  (select count(*) from tree p where p.path ~ ('^'||tree.path) and not p.path=tree.path) blocking_others,
  case when tree.pid=any(tree.dl) then '!>' else repeat(' .', lvl) end||' '||trim(left(regexp_replace(a.query, e'\\s+', ' ', 'g'),300)) latest_query_in_tx
from tree
left join pairs w on w.waiter = tree.pid and w.locker = tree.dad
join pg_stat_activity a using (pid)
join pg_stat_activity r on r.pid=tree.root
order by (now() - r.xact_start), path

```
~~~~

**Source [3]** — patroni/postgresql-locking.md > About Locking and cancelling/terminating queries > How to see locking and locked activity

~~~~text
patroni/postgresql-locking.md > About Locking and cancelling/terminating queries > How to see locking and locked activity

join pg_stat_activity a using (pid)
join pg_stat_activity r on r.pid=tree.root
order by (now() - r.xact_start), path

```

This will show a complete _tree_ of blocking and blocked queries:

```
 transaction_age | change_age | datname  | usename  | client_addr |  pid  | wait_event_type | wait_event | blocked_by_pids | state  | lvl | blocking_others |        latest_query_in_tx
-----------------+------------+----------+----------+-------------+-------+-----------------+------------+-----------------+--------+-----+-----------------+----------------------------------
 00:10:25        | 00:10:18   | locktest | postgres | 127.0.0.1   | 20252 | Client          | ClientRead | {}              | idletx |   0 |               1 |  lock TABLE mytable ;
 00:09:14        | 00:09:14   | locktest | postgres | 127.0.0.1   | 20594 | Lock            | relation   | {20252}         | active |   1 |               0 |  . select count(*) from mytable;
(2 rows)



```

Here, the _root_ of the blocking chain can be identified with a 0 (zero) in the ```lvl``` column.

In practice, you will probably add a `\watch 2` in _gitlab-psql_ session, for automatically repeat and refresh the screen.
~~~~

**Source [4]** — patroni/postgresql-locking.md > About Locking and cancelling/terminating queries > How to see locking and locked activity

~~~~text
patroni/postgresql-locking.md > About Locking and cancelling/terminating queries > How to see locking and locked activity

```sql
with recursive l as (
  select
    pid, locktype, granted,
    array_position(array['AccessShare','RowShare','RowExclusive','ShareUpdateExclusive','Share','ShareRowExclusive','Exclusive','AccessExclusive'], left(mode, -4)) m,
    row(locktype, database, relation, page, tuple, virtualxid, transactionid, classid, objid, objsubid) obj
  from pg_locks
), pairs as (
  select w.pid waiter, l.pid locker, l.obj, l.m
  from l w join l on l.obj is not distinct from w.obj and l.locktype = w.locktype and not l.pid = w.pid and l.granted
  where not w.granted
  and not exists (select from l i where i.pid=l.pid and i.locktype = l.locktype and i.obj is not distinct from l.obj and i.m > l.m)
), leads as (
  select o.locker, 1::int lvl, count(*) q, array[locker] track, false as cycle
  from pairs o
  group by o.locker
  union all
  select i.locker, leads.lvl + 1, (select count(*) from pairs q where q.locker = i.locker), leads.track || i.locker, i.locker = any(leads.track)
  from pairs i, leads
  where i.waiter=leads.locker and not cycle
), tree as (
  select locker pid,locker dad,locker root,case when cycle then track end dl, null::record obj,0 lvl, locker::text path, array_agg(locker) over () all_pids
  from leads o
  where
    (cycle and not exists (select from leads i where i.locker=any(o.track) and (i.lvl>o.lvl or i.q<o.q)))
~~~~

**Source [5]** — patroni/postgresql.md > Postgresql > Get a list of locked queries with the query that is blocking it

~~~~text
patroni/postgresql.md > Postgresql > Get a list of locked queries with the query that is blocking it

```
SELECT blockingl.relation::regclass,
  blockeda.pid AS blocked_pid, blockeda.query as blocked_query,
  blockedl.mode as blocked_mode,
  age(clock_timestamp(), blockeda.query_start) as blocked_query_duration,
  blockinga.pid AS blocking_pid, blockinga.query as blocking_query,
  blockingl.mode as blocking_mode,
  age(clock_timestamp(), blockinga.query_start) as blocking_query_duration
FROM pg_catalog.pg_locks blockedl
JOIN pg_stat_activity blockeda ON blockedl.pid = blockeda.pid
JOIN pg_catalog.pg_locks blockingl ON(blockingl.relation=blockedl.relation
  AND blockingl.locktype=blockedl.locktype AND blockedl.pid != blockingl.pid)
JOIN pg_stat_activity blockinga ON blockingl.pid = blockinga.pid
WHERE NOT blockedl.granted;
```
~~~~

### Answer to grade

Part of this is covered: the runbooks explain how to see what is blocking, but the excerpts contain no steps for cancelling or terminating the blocker.

**Seeing what is blocking**

1. Use `pg_stat_activity` (current activity, client, executing query) and `pg_locks` (lock activity, owning pid, whether the lock was granted or is waiting) as the two underlying sources. [1]
2. For a full tree of blocking and blocked queries, run the recursive query (Nikolay Samokhvalov's snippet) in the "How to see locking and locked activity" section. It combines `pg_stat_activity` and `pg_locks`. [1][4][2][3]
3. Read the output. The root of the blocking chain has `0` in the `lvl` column. The `blocked_by_pids` column shows which pid blocks each query. [3]
4. To refresh automatically, add `\watch 2` in the _gitlab-psql_ session. [3]
5. For a simpler flat list of blocked queries alongside the blocking query, use the `SELECT` on `pg_locks` joined to `pg_stat_activity` (filtered with `WHERE NOT blockedl.granted`) from the "Get a list of locked queries with the query that is blocking it" section. It shows the blocked and blocking pids, queries, lock modes, and durations. [5]

**Cancelling**

Not covered in the provided excerpts. The excerpts do not give the cancel/terminate commands or guidance on when it is safe to use them. Use the pid of the root blocker (`lvl` 0) from the output above once you find the cancel/terminate procedure in the runbook.

### YOUR GRADE (R03)

- Verdict (PASS / FAIL): 
- UNSUPPORTED or CONTRADICTED steps (step number + one line why): 
- MISCITED steps (step number, which source is right): 
- Missing warning or key step (which source says it): 
- Notes: 

---

## R04

**Question:** [FIRING:1] HostOutOfInodes instance=web-03 mountpoint=/var inodes_free=2%

### Sources

**Source [1]** — Basic resource monitoring > Host and hardware

~~~~text
Alert: Host out of inodes
Service: Host and hardware (Basic resource monitoring)
Severity: critical
Disk is almost running out of available inodes (< 10% left)
~~~~

**Source [2]** — Basic resource monitoring > Host and hardware

~~~~text
Alert: Host inodes may fill in 24 hours
Service: Host and hardware (Basic resource monitoring)
Severity: warning
Filesystem will likely run out of inodes within the next 24 hours at current write rate
~~~~

**Source [3]** — Basic resource monitoring > Host and hardware

~~~~text
Alert: Host out of disk space
Service: Host and hardware (Basic resource monitoring)
Severity: critical
Disk is almost full (< 10% left)
Please add ignored mountpoints in node_exporter parameters like
"--collector.filesystem.ignored-mount-points=^/(sys|proc|dev|run)($|/)".
Same rule using "node_filesystem_free_bytes" will fire when disk fills for non-root users.
~~~~

**Source [4]** — Basic resource monitoring > Host and hardware

~~~~text
Alert: Host disk may fill in 24 hours
Service: Host and hardware (Basic resource monitoring)
Severity: warning
Filesystem will likely run out of space within the next 24 hours.
Please add ignored mountpoints in node_exporter parameters like
"--collector.filesystem.ignored-mount-points=^/(sys|proc|dev|run)($|/)".
Same rule using "node_filesystem_free_bytes" will fire when disk fills for non-root users.
~~~~

**Source [5]** — kube/alerts/kube_persistent_volume_claim_inodes.md > component_saturation_slo_out_of_bounds:kube_persistent_volume_claim_inodes > Related Links

~~~~text
kube/alerts/kube_persistent_volume_claim_inodes.md > component_saturation_slo_out_of_bounds:kube_persistent_volume_claim_inodes > Related Links

- [Related alerts](https://gitlab.com/gitlab-com/runbooks/-/tree/master/docs/kube/alerts)
- [Related documentation](https://gitlab.com/gitlab-com/runbooks/-/tree/master/docs/kube)
- [Filesystem inode troubleshooting (host-level)](../../monitoring/filesystem_alerts_inodes.md)
~~~~

### Answer to grade

1. The "Host out of inodes" alert is critical. It means the disk has less than 10% of its inodes left [1]. Your alert shows 2% free on `/var` on web-03, which is well under that threshold.
2. The related warning alert, "Host inodes may fill in 24 hours", fires when the filesystem is predicted to run out of inodes within 24 hours at the current write rate [2]. Check whether it also fired for this host.
3. For host-level inode troubleshooting, the runbooks point to `monitoring/filesystem_alerts_inodes.md` [5]. Its contents are not in the excerpts.

**Missing:** The excerpts contain no diagnostic or remediation steps for freeing inodes, such as how to find what is consuming them or what is safe to delete. Open the linked document in step 3 for those.

### YOUR GRADE (R04)

- Verdict (PASS / FAIL): 
- UNSUPPORTED or CONTRADICTED steps (step number + one line why): 
- MISCITED steps (step number, which source is right): 
- Missing warning or key step (which source says it): 
- Notes: 

---

## R05

**Question:** site-to-site VPN tunnel keeps flapping

### Sources

**Source [1]** — Network and security > WireGuard

~~~~text
Alert: WireGuard peer handshake too old
Service: WireGuard (Network and security)
Severity: warning
WireGuard peer {{ $labels.public_key }} on interface {{ $labels.interface }} has not had a handshake for over 5 minutes. The tunnel may be down.
The threshold of 300 seconds (5 minutes) is a rough default. WireGuard peers that are idle but reachable
typically re-handshake every 2 minutes. Adjust based on your keepalive interval.
The `> 0` guard excludes peers that have never completed a handshake (covered by a separate rule).
~~~~

**Source [2]** — Network and security > WireGuard

~~~~text
Alert: WireGuard peer handshake never established
Service: WireGuard (Network and security)
Severity: critical
WireGuard peer {{ $labels.public_key }} on interface {{ $labels.interface }} has never completed a handshake. Check peer configuration and network connectivity.
This alert will fire for all offline mobile/laptop peers. Consider filtering by expected-online peers.
~~~~

**Source [3]** — Network and security > WireGuard

~~~~text
Alert: WireGuard no traffic on peer
Service: WireGuard (Network and security)
Severity: warning
WireGuard peer {{ $labels.public_key }} on interface {{ $labels.interface }} has had no traffic for 15 minutes despite an active handshake.
This alert fires when a peer has a recent handshake but zero traffic flow.
May indicate routing issues or a misconfigured allowed-ips.
Only useful if you expect continuous traffic on all peers.
~~~~

**Source [4]** — Network and security > sip-exporter

~~~~text
Alert: SIP exporter one-way RTP high
Service: sip-exporter (Network and security)
Severity: warning
{{ $value | humanizePercentage }} of sip-exporter dialogs on {{ $labels.instance }} for carrier {{ $labels.carrier }} direction {{ $labels.direction }} had one-way RTP. Check NAT, SDP addresses, and media-path visibility.
5% is a rough default. Tune it only after confirming both negotiated media directions normally reach the sensor.
~~~~

**Source [5]** — Network and security > sip-exporter

~~~~text
Alert: SIP exporter dialogs missing RTP high
Service: sip-exporter (Network and security)
Severity: warning
{{ $value | humanizePercentage }} of sip-exporter dialogs on {{ $labels.instance }} for carrier {{ $labels.carrier }} direction {{ $labels.direction }} ended without observed RTP. Check SDP reachability, filtering, and capture topology.
5% is a rough default. Tune it only after confirming the sensor normally observes both SIP signaling and the negotiated media path.
~~~~

### Answer to grade

Not found in the runbooks.

### YOUR GRADE (R05)

- Verdict (CORRECT / WRONG): 
- Do any of the 5 sources actually answer the question? (which, and what they say): 
- Notes: 

---

## R06

**Question:** the Rails SQL apdex alert is firing, what should I check in the first few minutes

### Sources

**Source [1]** — patroni/rails-sql-apdex-slow.md > Rails SQL Apdex alerts > What to do in the first 5 minutes

~~~~text
patroni/rails-sql-apdex-slow.md > Rails SQL Apdex alerts > What to do in the first 5 minutes

- Be aware of the [primary database](https://dashboards.gitlab.net/d/000000244/postgresql-replication-overview?orgId=1) for log queries
- Check the dashboards and log links below to asses root cause
- See if there is a quick recovery, if not page the IMOC who will bring in the CMOC in case we need to make a status page update
~~~~

**Source [2]** — patroni/rails-sql-apdex-slow.md > Rails SQL Apdex alerts > What to do in the first 5 minutes > Logs

~~~~text
patroni/rails-sql-apdex-slow.md > Rails SQL Apdex alerts > What to do in the first 5 minutes > Logs

- [Primary queries by endpoint_id if it exists](https://log.gprd.gitlab.net/goto/c9386085d6722f2b05cc3cc251cca1ea)
  - Grab the first `endpoint_id`, search [the logs](https://log.gprd.gitlab.net/goto/07606a8985e78fa0a4f83e07f043c7d5) by setting  `json.meta.caller_id` to the `endpoint_id` and try to find a common denominator, for example, `json.meta.root_namespace`.
  - If you don't find a common denominator, try adding the filter `json.job_status: fail`, [example](https://log.gprd.gitlab.net/goto/988a7e9fa3fa48a7a8fb71f47631d0d4); This can remove noise in some cases and help find the offender.
- [Slow queries on the primary](https://log.gprd.gitlab.net/goto/7648f3995aa30dd1681fd9f4af2c13c0)
- [Statement timeouts on the primary](https://log.gprd.gitlab.net/goto/cf201d6e014b00e4eef016a026c7228f)
- [Locks on the primary](https://log.gprd.gitlab.net/goto/cbf49fde89fe33c78d57d9a6a2bc2916)
~~~~

**Source [3]** — patroni/rails-sql-apdex-slow.md > Rails SQL Apdex alerts

~~~~text
patroni/rails-sql-apdex-slow.md > Rails SQL Apdex alerts

When we see an SQL Apdex alert is important to quickly asses the impact and rule out common causes like abuse and identify problematic queries.
This runbook covers some of the topics that were discussed in the [EOC Firedrill](https://docs.google.com/document/d/1WiHy60tedoZnjKs8ypceHVu8p-E0-6wXZkzFb02P4CY/edit#heading=h.39dmlgcxc042).
~~~~

**Source [4]** — patroni/rails-sql-apdex-slow.md > Rails SQL Apdex alerts > What to do in the first 5 minutes > Abuse

~~~~text
patroni/rails-sql-apdex-slow.md > Rails SQL Apdex alerts > What to do in the first 5 minutes > Abuse

Often abuse can be the source of DB degradation, to see if there might be abuse happening reference the [abuse runbook](../ci-runners/troubleshooting-guide.md#how-to-detect-ci-abuse)
~~~~

**Source [5]** — patroni/rails-sql-apdex-slow.md > Rails SQL Apdex alerts > What to do in the first 5 minutes > Metric queries

~~~~text
patroni/rails-sql-apdex-slow.md > Rails SQL Apdex alerts > What to do in the first 5 minutes > Metric queries

- Check [top query durations by ID](https://thanos.gitlab.net/graph?g0.range_input=30m&g0.end_input=2021-03-18%2014%3A15&g0.step_input=3&g0.moment_input=2021-03-18%2014%3A30%3A46&g0.max_source_resolution=0s&g0.expr=topk(10%2C%20%0A%20%20sum%20by%20(queryid)%20(%0A%20%20%20%20rate(pg_stat_statements_seconds_total%7Benv%3D%22gprd%22%2C%20monitor%3D%22db%22%2C%20type%3D%22patroni%22%2Cinstance%3D%22patroni-03-db-gprd.c.gitlab-production.internal%3A9187%22%7D%5B1m%5D)%0A%20%20)%0A)&g0.tab=0)
~~~~

### Answer to grade

1. Quickly assess impact and rule out common causes like abuse, and identify problematic queries. [3]
2. Be aware of the primary database for log queries. [1]
3. Check the dashboards and log links to assess root cause. [1]
4. Rule out abuse by following the abuse runbook (CI abuse detection). [4]
5. Check logs: [2]
   - Primary queries by `endpoint_id`, if it exists. Take the first `endpoint_id`, search the logs with `json.meta.caller_id` set to it, and look for a common denominator such as `json.meta.root_namespace`. [2]
   - If there is no common denominator, add the filter `json.job_status: fail` to remove noise and help find the offender. [2]
   - Slow queries on the primary. [2]
   - Statement timeouts on the primary. [2]
   - Locks on the primary. [2]
6. Check metrics: top query durations by ID (Thanos). [5]
7. See if there is a quick recovery. If not, page the IMOC, who will bring in the CMOC if a status page update is needed. [1]

### YOUR GRADE (R06)

- Verdict (PASS / FAIL): 
- UNSUPPORTED or CONTRADICTED steps (step number + one line why): 
- MISCITED steps (step number, which source is right): 
- Missing warning or key step (which source says it): 
- Notes: 

---

## R07

**Question:** server clock is drifting and NTP is not syncing

### Sources

**Source [1]** — Basic resource monitoring > Host and hardware

~~~~text
Alert: Host clock skew
Service: Host and hardware (Basic resource monitoring)
Severity: warning
Clock skew detected. Clock is out of sync. Ensure NTP is configured correctly on this host.
~~~~

**Source [2]** — Basic resource monitoring > Host and hardware

~~~~text
Alert: Host clock not synchronising
Service: Host and hardware (Basic resource monitoring)
Severity: warning
Clock not synchronising. Ensure NTP is configured on this host.
~~~~

**Source [3]** — Basic resource monitoring > Windows Server

~~~~text
Alert: Windows Server NTP client delay
Service: Windows Server (Basic resource monitoring)
Severity: warning
NTP round-trip delay between {{ $labels.instance }} and its time source exceeds 1 second, which reduces time synchronization accuracy and may point to network issues.
1s threshold is a rough default; acceptable round-trip time depends on your network topology (local NTP server vs internet-based) — adjust based on your baseline.
~~~~

**Source [4]** — Basic resource monitoring > Windows Server

~~~~text
Alert: Windows Server clock offset
Service: Windows Server (Basic resource monitoring)
Severity: warning
System clock on {{ $labels.instance }} is offset from its configured time source by more than 1 second, which can break Kerberos authentication, Active Directory replication and log correlation.
~~~~

**Source [5]** — Storage > Ceph

~~~~text
Alert: Ceph monitor clock skew
Service: Ceph (Storage)
Severity: warning
Ceph monitor clock skew detected. Please check ntp and hardware clock settings
~~~~

### Answer to grade

The runbooks only give general guidance for this; there are no detailed remediation steps.

1. For a Linux/general host with clock skew or a clock that isn't synchronising, ensure NTP is configured correctly on the host. [1][2]
2. On a Windows Server, check the NTP round-trip delay to the time source. A delay over 1 second reduces sync accuracy and may point to network issues. The 1s threshold is a rough default, so compare it against your network baseline (local NTP server vs internet-based). [3]
3. On a Windows Server, an offset of more than 1 second from the configured time source can break Kerberos authentication, Active Directory replication and log correlation. [4]
4. If the host is a Ceph monitor, check NTP and hardware clock settings. [5]

Missing: the excerpts don't include specific commands, config file locations, or steps to diagnose why NTP isn't syncing or to force a resync.

### YOUR GRADE (R07)

- Verdict (PASS / FAIL): 
- UNSUPPORTED or CONTRADICTED steps (step number + one line why): 
- MISCITED steps (step number, which source is right): 
- Missing warning or key step (which source says it): 
- Notes: 

---

## R08

**Question:** EKS nodes are not joining the cluster after karpenter scaled up

### Sources

**Source [1]** — kube/alerts/KubeSchedulingFailures.md > KubeSchedulingFailures > Troubleshooting > Top causes we have seen in production

~~~~text
kube/alerts/KubeSchedulingFailures.md > KubeSchedulingFailures > Troubleshooting > Top causes we have seen in production

Cluster (node) subnet exhausted: the cluster must be reprovisioned with a larger subnet. Coordinate with networking; this is not a quick fix. |
| `scale.up.error.waiting.for.instances.timeout` | GCE instance creation timed out before the node became Ready. | Check the [GCP status page](https://status.cloud.google.com/), retry, and inspect the node pool image and startup. If recent, correlate with image version or terraform changes. |
| Max nodes reached (Terraform cap) | The node pool is at its configured maximum and the autoscaler cannot grow it. | Correlates with `component_saturation_slo_out_of_bounds:kube_pool_max_nodes`. Raise the cap in [`config-mgmt`](https://ops.gitlab.net/gitlab-com/gl-infra/config-mgmt/) only after confirming headroom is needed. Note: `maxSize` cannot exceed the number of IPs available in the cluster subnet. If the subnet is the binding limit, see the `scale.up.error.ip.space.exhausted` row instead. |
| Workload misconfiguration | Node affinity, nodeSelector, taints or tolerations, or topology spread constraints prevent scheduling on any existing node, and no scale-up will help. | Revert the offending workload MR (typically in [`k8s-workloads`](https://gitlab.com/groups/gitlab-com/gl-infra/k8s-workloads) or [`argocd`](https://gitlab.com/gitlab-com/gl-infra/argocd)). |
~~~~

**Source [2]** — kube/k8s-cluster-rebuild.md > Rebuild a GKE cluster > Known caveats

~~~~text
kube/k8s-cluster-rebuild.md > Rebuild a GKE cluster > Known caveats

- **Control plane resize during initial GitLab deployment**: during the first `gprd` rebuild, `pdcsi-node` pods crashlooped for close to an hour because the API server was intermittently unavailable. The cause was an automatic [GKE control plane resize](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/regional-clusters#control_plane_management) triggered by the sudden surge in API load from deploying the full GitLab chart into an empty cluster. Zonal clusters run a single-replica control plane and briefly become unavailable during resizes ([Planning cluster scalability](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/planning-scalability#control_plane_availability)). The problem resolved itself once the resize completed. If you see new nodes stuck `NotReady` with API-timeout logs, check the [cluster's operations](https://docs.cloud.google.com/kubernetes-engine/docs/troubleshooting) for an in-progress `UPGRADE_MASTER` or `RESIZE_CLUSTER` and wait it out.
- **Calico legacy clusters**: `gprd-gitlab-gke` and `gstg-gitlab-gke` still run Calico. Their rebuild is tracked under [&1651](https://gitlab.com/groups/gitlab-com/gl-infra/-/epics/1651).
~~~~

**Source [3]** — kube/alerts/KubeSchedulingFailures.md > KubeSchedulingFailures > Troubleshooting

~~~~text
kube/alerts/KubeSchedulingFailures.md > KubeSchedulingFailures > Troubleshooting

For each affected pod, `kubectl describe pod -n <namespace> <pod>` will show the scheduler's reason in the `Events` section. Common reasons:

    - `Insufficient cpu` or `Insufficient memory`: the cluster needs to scale up. Go to step 5.
    - `node(s) didn't match Pod's node affinity/selector`: workload is constrained to a node pool or zone that has no capacity.
    - `node(s) had untolerated taint {...}`: workload is missing a toleration, or a taint was added.
    - `0/N nodes are available: N node(s) didn't have free ports`: host-port conflict.
    - `pod has unbound immediate PersistentVolumeClaims`: PVC or storage problem.

5. Review the Cluster Autoscaler's own status snapshot:

    ```bash
    kubectl describe configmap cluster-autoscaler-status -n kube-system
    ```

    This is usually the fastest way to pinpoint the failing node pool. Look for:

    - `Health` per node group. A `Healthy: False` block names the node group and the reason.
    - `ScaleUp` block. States are `InProgress`, `NoActivity`, or `Backoff`. A `Backoff` block includes the last error and the retry time.
    - Node group sizes: `cloudProviderTarget`, `minSize`, `maxSize`. A node group at `maxSize` cannot scale further; this often correlates with the `component_saturation_slo_out_of_bounds:kube_pool_max_nodes` saturation alert.
    - Last transition timestamps. Correlate with the alert firing time.
~~~~

**Source [4]** — kube/alerts/GKENodeCountCritical.md > GKENodeCountCritical > Troubleshooting

~~~~text
kube/alerts/GKENodeCountCritical.md > GKENodeCountCritical > Troubleshooting

1. Check pending pods and their reasons — see [`KubeSchedulingFailures`](KubeSchedulingFailures.md).
2. If the pool has been at cap and the workload is healthy, raise `gke_nodepool_max_nodes` for the relevant pool in `config-mgmt`. Apply via Atlantis.
3. Before raising, verify:
   - The cluster subnet has enough IPs. `maxSize` cannot exceed the number of IPs in the pod CIDR range. Follow [k8s-operations.md — Add a secondary pod IP range](../k8s-operations.md#add-a-secondary-pod-ip-range) if the subnet is the binding limit.
   - GCP quota (CPUs, in-use IPs, disk types, instance group size) allows more nodes.
4. If the cap is high enough but new nodes fail to come up, follow the `scale.up.error.*` diagnostics in [`KubeSchedulingFailures`](KubeSchedulingFailures.md#top-causes-we-have-seen-in-production).
~~~~

**Source [5]** — kube/alerts/HPAScaleCapability.md > HPAScaleCapability > Related Links

~~~~text
kube/alerts/HPAScaleCapability.md > HPAScaleCapability > Related Links

- [Related alerts](./)
- [k8s-operations.md — Manually scale a Deployment](../k8s-operations.md#manually-scale-a-deployment)
- [`KubeSchedulingFailures`](KubeSchedulingFailures.md) — related when scale-up is blocked at the node level.
- [`GKENodeCountCritical`](GKENodeCountCritical.md) — related capacity signal (paging alert plus soft-threshold guidance).
~~~~

### Answer to grade

Not found in the runbooks.

### YOUR GRADE (R08)

- Verdict (CORRECT / WRONG): 
- Do any of the 5 sources actually answer the question? (which, and what they say): 
- Notes: 

---

## R09

**Question:** how do I rotate the database password the rails app uses without downtime

### Sources

**Source [1]** — patroni/rotating-rails-postgresql-password.md > Rotating Rails' PostgreSQL password

~~~~text
patroni/rotating-rails-postgresql-password.md > Rotating Rails' PostgreSQL password

Follow the following steps in order to rotate the password of the PostgreSQL
user used by the Rails application.

The process involves creating temporary credentials to be used by the application
while we rotate the old password, in order to avoid running into unauthenticated
connection errors.

Create a [C1 change request](https://gitlab.com/gitlab-com/gl-infra/production/-/issues/new?issuable_template=change_c1),
add the steps below to the request, changing the following:

* `[old-username]` to the current username used by the Rails application, usually it is `gitlab`
* `[temp-username]` to anything reasonable, e.g. `gitlab-app`
* `<env>` to the target environment identifier, e.g. `gstg`, `gprd`, `dr`, ...

There are inline comments, to explain some of the steps, pay attention to them.
```
1. [ ] On a database node, run `sudo -u gitlab-psql /usr/lib/postgresql/9.6/bin/pg_dumpall -h localhost -p 5432 -U gitlab-superuser --roles-only | grep 'ROLE [old-username]\b'`
    <!--
    If the old username contains a dash, then you need to wrap the username in double-quotes and drop the `\b` e.g. `grep ROLE "gitlab-app"`

    An output will be like:
    CREATE ROLE gitlab;
    ALTER ROLE gitlab WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 270 ENCRYPTED PASSWORD  'md5foobarbaz';
    ALTER ROLE gitlab SET statement_timeout TO '10s';
    -->
~~~~

**Source [2]** — patroni/rotating-rails-postgresql-password.md > Rotating Rails' PostgreSQL password

~~~~text
patroni/rotating-rails-postgresql-password.md > Rotating Rails' PostgreSQL password

1. [ ] `knife ssh roles:<env>-base-db-patroni "sudo gitlab-psql -c \"SELECT COUNT(*) FROM pg_stat_activity WHERE usename='[old-username]'\""`
        * All counts should be zero
    1. [ ] `knife ssh 'roles:<env>-base-db-patroni roles:<env>-base-db-pgbouncer-pool' 'sudo tail -f /var/log/gitlab/pgbouncer/pgbouncer.log' | grep "password authentication failed"`
        * No recent entries should exist
1. [ ] On the primary DB, in a psql console, change the password for the old username by running `ALTER ROLE [old-username] ENCRYPTED PASSWORD '[new-password]'`
1. [ ] Update the password in 1Password or create a new entry for it. Entry name should be `<env> postgres gitlab user`
1. [ ] In `gitlab-omnibus-secrets` and `gitlab-omnibus-secrets-geo` GKMS vaults, under `omnibus-gitlab.gitlab_rb.gitlab-rails`:
    1. [ ] Update `db_password` to `[new-password]`
    1. [ ] Update `db_username` to `[old-username]`
1. [ ] Update `omnibus-gitlab.gitlab_rb.gitlab-rails.db_username` in `<env>-base` Chef role to `[old-username]`
    <!--
    Example: https://ops.gitlab.net/gitlab-com/gl-infra/chef-repo/-/merge_requests/3179/diffs
    -->
1. [ ] Converge Chef on one client node and check for errors
    1. [ ] If the single node fails to connect to the database, revert the change in GKMS as quickly as possible. Otherwise the entire fleet might pick up wrong credentials.
~~~~

**Source [3]** — patroni/rotating-rails-postgresql-password.md > Rotating Rails' PostgreSQL password

~~~~text
patroni/rotating-rails-postgresql-password.md > Rotating Rails' PostgreSQL password

ALTER ROLE gitlab SET statement_timeout TO '10s';
    -->
1. [ ] Copy the output, replace all occurrence of `[old-username]` with `"[temp-username]"`
1. [ ] In the output, the `ALTER ROLE ... WITH ...` line, replace `PASSWORD` with `ENCRYPTED PASSWORD` and the password after `PASSWORD` with a secure password. This will be `[temp-username]`'s password.
1. [ ] On the primary DB, in a psql console, run updated output
1. [ ] On the primary DB, in a psql console, run `GRANT [old-username] to "[temp-username]"`
1. [ ] In `gitlab-omnibus-secrets` and `gitlab-omnibus-secrets-geo` GKMS vaults, under `omnibus-gitlab.gitlab_rb.gitlab-rails`:
    1. [ ] Update `db_password` to `[temp-username]`'s password
    1. [ ] Update `db_username` to `[temp-username]`
    <!--
    Ideally, `db_username` is updated in a Chef role, but since there would a delay between applying the role
    and updating the vault, there's a chance of clients getting half of the change (i.e. `[old-username]` with
    `[temp-username]`'s password or `[temp-username]` with `[old-username]`'s password).

    Adding both db_username and db_password to the vault is important to have the new credentials updated correctly.
    -->
1. [ ] Update `omnibus-gitlab.gitlab_rb.gitlab-rails.db_username` in `<env>-base` Chef role to `[temp-username]`
    <!--
~~~~

**Source [4]** — patroni/postgresql-role-credential-rotation.md > Credential rotation

~~~~text
patroni/postgresql-role-credential-rotation.md > Credential rotation

Rotating credentials in a high-availability database deployment with the
objective to ensure zero downtime can be a challenge.

Here are some explicit tasks which are required to accomplish the changing
of a password for an important database role like `gitlab-superuser`.
~~~~

**Source [5]** — patroni/rotating-rails-postgresql-password.md > Rotating Rails' PostgreSQL password

~~~~text
patroni/rotating-rails-postgresql-password.md > Rotating Rails' PostgreSQL password

* No recent entries should exist
    1. [ ] Check Sentry for any errors related to failed DB login attempts
1. [ ] On the primary DB, in a psql console, drop `[temp-username]` by running `DROP ROLE "[temp-username]"`
1. [ ] In `gitlab-omnibus-secrets` and `gitlab-omnibus-secrets-geo` GKMS vaults, remove `omnibus-gitlab.gitlab_rb.gitlab-rails.db_username` to avoid confusion
```
~~~~

### Answer to grade

1. Create a C1 change request and add the steps below to it. Replace `[old-username]` (usually `gitlab`), `[temp-username]` (e.g. `gitlab-app`) and `<env>` [1].
2. On a database node, dump the old role's definition with `pg_dumpall --roles-only` and grep for `ROLE [old-username]`. If the username contains a dash, wrap it in double quotes and drop the `\b` [1].
3. Copy the output and replace every `[old-username]` with `"[temp-username]"` [3].
4. In the `ALTER ROLE ... WITH ...` line, change `PASSWORD` to `ENCRYPTED PASSWORD` and set a secure password. This is the temp user's password [3].
5. On the primary DB in psql, run the edited output, then `GRANT [old-username] to "[temp-username]"` [3].
6. In the `gitlab-omnibus-secrets` and `gitlab-omnibus-secrets-geo` GKMS vaults, under `omnibus-gitlab.gitlab_rb.gitlab-rails`, set both `db_password` (the temp password) and `db_username` (`[temp-username]`). Set both in the vault so clients don't get a mismatched username and password [3].
7. Update `db_username` in the `<env>-base` Chef role to `[temp-username]` [3].
8. Before changing the old password, confirm nothing still uses it [2]:
   - `pg_stat_activity` counts for `[old-username]` must all be zero.
   - There must be no recent "password authentication failed" entries in the pgbouncer logs.
9. On the primary DB, run `ALTER ROLE [old-username] ENCRYPTED PASSWORD '[new-password]'` [2].
10. Save the new password in 1Password under the entry name `<env> postgres gitlab user` [2].
11. In both GKMS vaults, set `db_password` to the new password and `db_username` to `[old-username]` [2].
12. Set `db_username` in the `<env>-base` Chef role back to `[old-username]` [2].
13. Converge Chef on one client node and check for errors. If it can't connect to the database, revert the GKMS change as quickly as possible, otherwise the whole fleet might pick up wrong credentials [2].
14. Clean up [5]:
    - Check that no recent auth-failure entries exist and that Sentry shows no failed DB login errors.
    - Run `DROP ROLE "[temp-username]"` on the primary.
    - Remove `omnibus-gitlab.gitlab_rb.gitlab-rails.db_username` from the vaults.

Missing from the excerpts: how the temp credentials and the final credentials roll out to the rest of the fleet, such as the Chef converge and wait steps between steps 7 and 8 and between steps 13 and 14.

### YOUR GRADE (R09)

- Verdict (PASS / FAIL): 
- UNSUPPORTED or CONTRADICTED steps (step number + one line why): 
- MISCITED steps (step number, which source is right): 
- Missing warning or key step (which source says it): 
- Notes: 

---

## R10

**Question:** the postgres server ran out of disk space

### Sources

**Source [1]** — patroni/postgresql-disk-space.md > PostgreSQL > So your Postgres server has run out of disk space

~~~~text
patroni/postgresql-disk-space.md > PostgreSQL > So your Postgres server has run out of disk space

* Don't panic -- Postgres should handle the situation cleanly

* Check `tail /var/log/gitlab/postgresql/current`
* Check `select * from pg_replication_slots`
* Check `du -sh /var/opt/gitlab/postgresql/data/pg_xlog`

In fact often Postgres will just generate regular transaction ERRORs
and continue without crashing at all. This is especially true if it's
mainly running read-only queries. Whent there is disk space available
again it will continue as if nothing happened. So if the server is
still up focus on adding space or finding the log files or other files
consuming space.

If it cannot write XLOG then it will crash. The log files will show a
`PANIC` log message.  But when the disk space is free again it should
start up and do regular crash recovery so still focus on adding space
or identifying the top consumer of space and cleaning it up.

* If the `pg_xlog` (or `pg_wal` in PG 11+) directory is the problem:

If there's a replication slot that has `active` false and has a
markedly old `restart_lsn` then it may be forcing Postgres to keep
lots of old xlog around.

If the replica cannot be resurrected (or if there are other healthy
replicas and you would rather get the primary back sooner and lose
this one) then run `select pg_drop_replication_slot('slot_name');`
~~~~

**Source [2]** — patroni/postgresql-disk-space.md > PostgreSQL > So your Postgres server has run out of disk space

~~~~text
patroni/postgresql-disk-space.md > PostgreSQL > So your Postgres server has run out of disk space

ideally you should retain more than that. Just remove a minimum number
of the oldest files.

*WARNING*: Do not remove any files that end in `.history`. These files
are needed for standbys to follow the wal through timeline forks. A
new standby will not start up if this file is not present.
~~~~

**Source [3]** — patroni/postgres.md > Postgresql troubleshooting > Errors > Check the database error logs

~~~~text
patroni/postgres.md > Postgresql troubleshooting > Errors > Check the database error logs

Resource starvation (full disk, out of memory, exhausted file descriptors)
lets Postgres keep serving read-only queries while every read-write
transaction rolls back.

1. Open the [Postgres logs in Kibana](https://log.gprd.gitlab.net/goto/d0f8993486c9007a69d85e3a08f1ea7c),
   narrow to the affected node (filter on `fqdn`), and search the message
   text for `FATAL`, `PANIC`, or `ERROR`.
2. Look for the signatures of resource starvation:
   - **Full disk / I/O:** `No space left on device`, `could not extend file`, `could not write to file`
   - **Out of memory:** `out of memory`, `cannot allocate memory`
   - **File descriptors:** `too many open files`
   - **Lock/timeout-driven rollbacks:** `deadlock detected`, `canceling statement due to statement timeout`, `could not serialize access`
3. If the logs point to host-level starvation, confirm on the node directly:

   ```shell
   df -h /var/opt/gitlab/postgresql   # disk space
   free -m                            # memory

   ```
~~~~

**Source [4]** — patroni/postgresql-disk-space.md > PostgreSQL > So your Postgres server has run out of disk space

~~~~text
patroni/postgresql-disk-space.md > PostgreSQL > So your Postgres server has run out of disk space

replicas and you would rather get the primary back sooner and lose
this one) then run `select pg_drop_replication_slot('slot_name');`

If the server has already crashed then the best strategy is to find a
few gigabytes to remove, start it up and then run
`pg_drop_replication_slot` as above. On our servers there is a file
`DO_NOT_MOVE_THIS_FILE` which you can remove to create space to do
this.

Failing that you may have to remove old xlog files manually. This is
extremely hazardous as if you remove a needed file the server will be
lost and unable to recover.

You can check the log files for the last few checkpoint logs or you
can run pg_controldata:

```
$ /opt/gitlab/embedded/postgresql/bin/pg_controldata /var/opt/gitlab/postgresql/data

Latest checkpoint location:           2B78/E30A3218
Prior checkpoint location:            2B78/DD37A880
Latest checkpoint's REDO location:    2B78/DF728AB8
Latest checkpoint's REDO WAL file:    0000000400002B78000000DF
```

*WARNING*: Do not under any circumstances remove any xlog files newer
than these xlog locations. The "Latest checkpoint's REDO WAL file" is
the simplest one to follow as it's the actual file name. However
ideally you should retain more than that. Just remove a minimum number
of the oldest files.
~~~~

**Source [5]** — patroni/postgres.md > Postgresql troubleshooting > Replication Slots > Symptoms

~~~~text
patroni/postgres.md > Postgresql troubleshooting > Replication Slots > Symptoms

An unused replication slot in a primary will cause the primary to keep around a
large and growing amount of WAL (XLOG) in `pg_wal/`. This can eventually cause
low disk space free alerts and even an outage.
~~~~

### Answer to grade

1. Don't panic. Postgres often handles a full disk cleanly, with transaction ERRORs and no crash, and resumes normally once space is available [1].
2. Check the logs, replication slots, and WAL directory size [1]:
   - `tail /var/log/gitlab/postgresql/current`
   - `select * from pg_replication_slots`
   - `du -sh /var/opt/gitlab/postgresql/data/pg_xlog`
3. In the Postgres logs (Kibana, filtered on the node's `fqdn`), look for `No space left on device`, `could not extend file`, or `could not write to file` [3]. Confirm on the node with `df -h /var/opt/gitlab/postgresql` [3].
4. If the server is still up, focus on adding space or finding the log files or other files consuming space [1].
5. If it crashed (the logs show `PANIC` because it couldn't write XLOG), it should do normal crash recovery once space is freed. So free space or find the top consumer and clean it up [1].
6. If `pg_xlog` (or `pg_wal` in PG 11+) is the problem, look for a replication slot with `active` false and a markedly old `restart_lsn`, since it may be forcing Postgres to keep old xlog [1][5].
7. If that replica can't be resurrected, or other healthy replicas exist and you'd rather get the primary back sooner, run `select pg_drop_replication_slot('slot_name');` [1].
8. If the server has already crashed, free a few GB, start it up, then drop the slot as above. Removing the file `DO_NOT_MOVE_THIS_FILE` on these servers creates that space [4].
9. Last resort: remove old xlog files manually. This is extremely hazardous, because removing a needed file means the server is lost and cannot recover [4].
   - Find the latest checkpoint with the logs or `/opt/gitlab/embedded/postgresql/bin/pg_controldata /var/opt/gitlab/postgresql/data` [4].
   - **WARNING:** Do not under any circumstances remove xlog files newer than those checkpoint locations. Ideally retain more than "Latest checkpoint's REDO WAL file", and remove only a minimum number of the oldest files [4].
   - **WARNING:** Do not remove any files ending in `.history`. Standbys need them to follow the WAL through timeline forks, and a new standby won't start without them [2].

### YOUR GRADE (R10)

- Verdict (PASS / FAIL): 
- UNSUPPORTED or CONTRADICTED steps (step number + one line why): 
- MISCITED steps (step number, which source is right): 
- Missing warning or key step (which source says it): 
- Notes: 

---

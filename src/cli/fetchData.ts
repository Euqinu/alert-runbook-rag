// Recreates data/ from the two pinned upstream snapshots (see docs/DATA_SOURCES.md).
// Usage: npm run data:fetch [target-dir]      (default: data)
//
// Plain HTTPS only, no git clone: the GitLab repo contains file names that Windows cannot hold
// (colons, "aux.*"), so a normal clone fails there. We only ever download the .md files we use.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  GITLAB_COMMIT,
  PROMETHEUS_ALERTS_COMMIT,
} from "../ingestion/documents.js";

const GITLAB_PROJECT = "gitlab-com%2Frunbooks";
const GITLAB_FOLDERS = ["patroni", "redis", "pgbouncer", "kube", "elastic"];
const EXPECTED_RUNBOOKS = 128;
const PARALLEL_DOWNLOADS = 8;

const target = process.argv[2] ?? "data";

async function download(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  return res;
}

async function save(file: string, content: Buffer | string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

async function fetchRules(): Promise<void> {
  const res = await download(
    `https://raw.githubusercontent.com/samber/awesome-prometheus-alerts/${PROMETHEUS_ALERTS_COMMIT}/_data/rules.yml`,
  );
  const dir = path.join(target, "awesome-prometheus-alerts");
  await save(path.join(dir, "rules.yml"), Buffer.from(await res.arrayBuffer()));
  await save(
    path.join(dir, "SOURCE.txt"),
    `Source: https://github.com/samber/awesome-prometheus-alerts, commit ${PROMETHEUS_ALERTS_COMMIT}, file _data/rules.yml. License: CC BY 4.0 (credit the project, link the license, note changes).\n`,
  );
  console.log(
    `rules.yml: downloaded (commit ${PROMETHEUS_ALERTS_COMMIT.slice(0, 7)})`,
  );
}

/** All markdown files under one docs/ folder at the pinned commit (the API pages 100 at a time). */
async function listMarkdown(folder: string): Promise<string[]> {
  const paths: string[] = [];
  for (let page: number | null = 1; page !== null;) {
    const res = await download(
      `https://gitlab.com/api/v4/projects/${GITLAB_PROJECT}/repository/tree` +
        `?path=${encodeURIComponent(`docs/${folder}`)}&ref=${GITLAB_COMMIT}&recursive=true&per_page=100&page=${page}`,
    );
    const items = (await res.json()) as { type: string; path: string }[];
    for (const item of items)
      if (item.type === "blob" && item.path.endsWith(".md"))
        paths.push(item.path);
    const next = res.headers.get("x-next-page");
    page = next ? Number(next) : null;
  }
  return paths;
}

const rawUrl = (repoPath: string): string =>
  `https://gitlab.com/gitlab-com/runbooks/-/raw/${GITLAB_COMMIT}/${repoPath.split("/").map(encodeURIComponent).join("/")}`;

async function fetchRunbooks(): Promise<void> {
  const files = (await Promise.all(GITLAB_FOLDERS.map(listMarkdown))).flat();
  const dest = path.join(target, "gitlab-runbooks");

  for (let i = 0; i < files.length; i += PARALLEL_DOWNLOADS) {
    await Promise.all(
      files.slice(i, i + PARALLEL_DOWNLOADS).map(async (repoPath) => {
        const res = await download(rawUrl(repoPath));
        await save(
          path.join(dest, repoPath),
          Buffer.from(await res.arrayBuffer()),
        );
      }),
    );
  }

  // MIT requires keeping the copyright and license notice with the copied files.
  const license = await download(rawUrl("LICENSE"));
  await save(
    path.join(dest, "LICENSE"),
    Buffer.from(await license.arrayBuffer()),
  );
  await save(
    path.join(dest, "SOURCE.txt"),
    `Source: https://gitlab.com/gitlab-com/runbooks, commit ${GITLAB_COMMIT.slice(0, 7)}. Folders: docs/{${GITLAB_FOLDERS.join(",")}} (markdown files only). License: MIT (see LICENSE).\n`,
  );

  console.log(
    `runbooks: ${files.length} markdown files (expected ${EXPECTED_RUNBOOKS})`,
  );
  if (files.length !== EXPECTED_RUNBOOKS)
    console.warn(
      "WARNING: file count differs from the snapshot the eval numbers were measured on.",
    );
}

await fetchRules();
await fetchRunbooks();
console.log(`Done. Data is in ${path.resolve(target)}`);

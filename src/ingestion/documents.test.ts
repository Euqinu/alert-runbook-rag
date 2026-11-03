import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PROMETHEUS_ALERTS_COMMIT,
  fingerprint,
  loadAllDocuments,
  loadGitlabDocuments,
} from "./documents.js";

const RULES = `
groups:
  - name: G
    services:
      - name: S
        exporters:
          - slug: e
            rules:
              - name: Rule one
                description: First rule.
                query: "up == 0"
                severity: critical
`;

let dataDir: string;

async function write(rel: string, content: string): Promise<void> {
  const full = path.join(dataDir, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
}

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "rag-docs-"));
  await write("awesome-prometheus-alerts/rules.yml", RULES);
  await write(
    "gitlab-runbooks/docs/redis/redis.md",
    "# Troubleshooting\n\n## Is redis running?\n\nCheck status.\n",
  );
  await write(
    "gitlab-runbooks/docs/elastic/elastic-cloud.md",
    "# Elastic Cloud\n\nSome text.\n",
  );
  await write("gitlab-runbooks/docs/notes.txt", "not markdown");
});

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("loadAllDocuments", () => {
  it("returns the rules file plus one document per markdown file, in a stable order", async () => {
    const docs = await loadAllDocuments(dataDir);
    expect(docs.map((d) => d.source)).toEqual([
      "awesome-prometheus-alerts",
      "gitlab-runbooks",
      "gitlab-runbooks",
    ]);
    expect(
      docs.slice(1).map((d) => d.chunks[0]?.title.split(" > ")[0]),
    ).toEqual(["elastic/elastic-cloud.md", "redis/redis.md"]);
  });

  it("gives the rules document its license and a commit-pinned link to the source file", async () => {
    const [rules] = await loadAllDocuments(dataDir);
    expect(rules?.license).toBe("CC BY 4.0");
    expect(rules?.url).toBe(
      `https://github.com/samber/awesome-prometheus-alerts/blob/${PROMETHEUS_ALERTS_COMMIT}/_data/rules.yml`,
    );
  });

  it("gives every GitLab document an MIT license and a commit-pinned url", async () => {
    const docs = await loadGitlabDocuments(dataDir);
    for (const d of docs) {
      expect(d.license).toBe("MIT");
      expect(d.url).toMatch(
        /^https:\/\/gitlab\.com\/gitlab-com\/runbooks\/-\/blob\/[0-9a-f]{40}\/docs\/.+\.md$/,
      );
    }
  });

  it("produces unique urls, so (url, chunk_index) is unique", async () => {
    const docs = await loadAllDocuments(dataDir);
    expect(new Set(docs.map((d) => d.url)).size).toBe(docs.length);
  });

  it("is deterministic: loading twice gives identical hashes", async () => {
    const a = (await loadAllDocuments(dataDir)).map((d) => d.docHash);
    const b = (await loadAllDocuments(dataDir)).map((d) => d.docHash);
    expect(a).toEqual(b);
  });

  it("changes the hash when the chunking settings change, even if files are unchanged", async () => {
    const before = await loadGitlabDocuments(dataDir);
    const after = await loadGitlabDocuments(dataDir, {
      maxChars: 1000,
      overlapChars: 150,
    });
    expect(after.map((d) => d.docHash)).not.toEqual(
      before.map((d) => d.docHash),
    );
  });
});

describe("fingerprint", () => {
  it("changes with content", () => {
    expect(fingerprint("a", "s")).not.toBe(fingerprint("b", "s"));
  });

  it("changes with settings", () => {
    expect(fingerprint("a", "s1")).not.toBe(fingerprint("a", "s2"));
  });

  it("does not confuse where the settings end and the content begins", () => {
    expect(fingerprint("bc", "a")).not.toBe(fingerprint("c", "ab"));
  });
});

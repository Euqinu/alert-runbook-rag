import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "./embed.js";
import {
  DEFAULT_MARKDOWN_OPTIONS,
  chunkMarkdown,
  type MarkdownChunkOptions,
} from "./markdown.js";
import { chunkPrometheusRules } from "./prometheusRules.js";
import type { ChunkDraft } from "./types.js";

/**
 * Bump when a chunker's LOGIC changes (its settings are hashed automatically).
 * Without a bump, files whose content didn't change would be skipped and keep stale chunks.
 */
const PROMETHEUS_CHUNKER_VERSION = "prom-v1";
const MARKDOWN_CHUNKER_VERSION = "md-v1";

/** Upstream snapshots we ingest. Pinned so citations point at exactly the text we embedded. */
export const GITLAB_COMMIT = "92eb78a55a4a50532825adb6dabc0e17dabe9a35";
export const PROMETHEUS_ALERTS_COMMIT =
  "0fbd08449cf6e81c41569351e4fcee1f5c117501";

/** One unit of ingestion: everything the chunker doesn't know, plus the chunks it produced. */
export interface SourceDocument {
  source: string;
  url: string;
  license: string;
  /** Fingerprint of the file content AND the settings that shape the output. */
  docHash: string;
  chunks: ChunkDraft[];
}

/**
 * SHA-256 of the settings plus the content. Including the settings means that changing
 * a chunk size or the embedding model changes every hash, so everything gets rebuilt.
 */
export function fingerprint(content: string, settings: string): string {
  return createHash("sha256")
    .update(settings)
    .update("\0")
    .update(content)
    .digest("hex");
}

const embeddingSettings = `model=${EMBEDDING_MODEL};dim=${EMBEDDING_DIMENSIONS}`;

export async function loadPrometheusDocument(
  dataDir: string,
): Promise<SourceDocument> {
  const content = await readFile(
    path.join(dataDir, "awesome-prometheus-alerts", "rules.yml"),
    "utf8",
  );
  return {
    source: "awesome-prometheus-alerts",
    url: `https://github.com/samber/awesome-prometheus-alerts/blob/${PROMETHEUS_ALERTS_COMMIT}/_data/rules.yml`,
    license: "CC BY 4.0",
    docHash: fingerprint(
      content,
      `${PROMETHEUS_CHUNKER_VERSION};${embeddingSettings}`,
    ),
    chunks: chunkPrometheusRules(content),
  };
}

export async function loadGitlabDocuments(
  dataDir: string,
  options: MarkdownChunkOptions = DEFAULT_MARKDOWN_OPTIONS,
): Promise<SourceDocument[]> {
  const root = path.join(dataDir, "gitlab-runbooks");
  const settings = `${MARKDOWN_CHUNKER_VERSION};max=${options.maxChars};overlap=${options.overlapChars};${embeddingSettings}`;

  const files = (await readdir(path.join(root, "docs"), { recursive: true }))
    .map((f) => f.replaceAll("\\", "/"))
    .filter((f) => f.endsWith(".md"))
    .sort();

  const documents: SourceDocument[] = [];
  for (const file of files) {
    const content = await readFile(path.join(root, "docs", file), "utf8");
    documents.push({
      source: "gitlab-runbooks",
      url: `https://gitlab.com/gitlab-com/runbooks/-/blob/${GITLAB_COMMIT}/docs/${file}`,
      license: "MIT",
      docHash: fingerprint(content, settings),
      chunks: chunkMarkdown(content, file, options),
    });
  }
  return documents;
}

export async function loadAllDocuments(
  dataDir = "data",
): Promise<SourceDocument[]> {
  return [
    await loadPrometheusDocument(dataDir),
    ...(await loadGitlabDocuments(dataDir)),
  ];
}

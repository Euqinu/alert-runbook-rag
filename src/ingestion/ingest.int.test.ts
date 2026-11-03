// Integration test: needs the Postgres container (npm run db:up) and the migration applied.
// It only ever touches rows whose url starts with "test://", never real data. Skipped if the DB is down.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../db/client.js";
import type { SourceDocument } from "./documents.js";
import { EMBEDDING_DIMENSIONS } from "./embed.js";
import { ingest } from "./ingest.js";
import { replaceDocument } from "./store.js";

const dbUp = await pool.query("SELECT 1").then(
  () => true,
  () => false,
);

const vec = (n: number): number[] =>
  new Array<number>(EMBEDDING_DIMENSIONS).fill(n);

const doc = (
  url: string,
  docHash: string,
  texts: string[],
): SourceDocument => ({
  source: "test",
  url,
  license: "MIT",
  docHash,
  chunks: texts.map((text, chunkIndex) => ({
    text,
    title: "t",
    alertName: null,
    chunkIndex,
  })),
});

/** Fake Voyage: every text gets a valid 1024-number vector, no network. */
const fakeEmbed = async (texts: string[]) => ({
  embeddings: texts.map((_, i) => vec(i + 1)),
  totalTokens: texts.length,
});

const rowsFor = async (url: string) =>
  (
    await pool.query<{ text: string; doc_hash: string }>(
      "SELECT text, doc_hash FROM chunks WHERE url = $1 ORDER BY chunk_index",
      [url],
    )
  ).rows;

const cleanup = () =>
  pool.query("DELETE FROM chunks WHERE url LIKE 'test://%'");

describe.skipIf(!dbUp)("ingestion against Postgres", () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it("writes new documents, then skips them on the second run", async () => {
    const docs = [
      doc("test://a", "h1", ["a0", "a1"]),
      doc("test://b", "h2", ["b0"]),
    ];

    const first = await ingest(pool, docs, { embed: fakeEmbed });
    expect(first).toMatchObject({
      newDocs: 2,
      unchangedDocs: 0,
      chunksWritten: 3,
    });
    expect((await rowsFor("test://a")).map((r) => r.text)).toEqual([
      "a0",
      "a1",
    ]);

    const second = await ingest(pool, docs, { embed: fakeEmbed });
    expect(second).toMatchObject({
      newDocs: 0,
      changedDocs: 0,
      unchangedDocs: 2,
      chunksWritten: 0,
    });
  });

  it("replaces all old rows of a changed document and leaves others alone", async () => {
    await ingest(
      pool,
      [
        doc("test://a", "h1", ["a0", "a1", "a2"]),
        doc("test://b", "h2", ["b0"]),
      ],
      { embed: fakeEmbed },
    );

    const summary = await ingest(
      pool,
      [doc("test://a", "h1-edited", ["a0-new"]), doc("test://b", "h2", ["b0"])],
      { embed: fakeEmbed },
    );

    expect(summary).toMatchObject({ changedDocs: 1, unchangedDocs: 1 });
    expect(await rowsFor("test://a")).toEqual([
      { text: "a0-new", doc_hash: "h1-edited" },
    ]);
    expect(await rowsFor("test://b")).toHaveLength(1);
  });

  it("rolls back completely if an insert fails halfway, keeping the old rows", async () => {
    await ingest(pool, [doc("test://a", "h1", ["old0", "old1"])], {
      embed: fakeEmbed,
    });

    // Second vector has 3 numbers instead of 1024, so Postgres rejects the second insert.
    await expect(
      replaceDocument(pool, doc("test://a", "h2", ["new0", "new1"]), [
        vec(1),
        [1, 2, 3],
      ]),
    ).rejects.toThrow();

    expect(await rowsFor("test://a")).toEqual([
      { text: "old0", doc_hash: "h1" },
      { text: "old1", doc_hash: "h1" },
    ]);
  });
});

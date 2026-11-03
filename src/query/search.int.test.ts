// Integration test: needs the Postgres container. Only touches rows whose url starts with "testsearch://".
// The test vectors point along single axes, which real embeddings essentially never do,
// so the real rows in the table cannot outrank them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db/client.js";
import { EMBEDDING_DIMENSIONS } from "../ingestion/embed.js";
import { replaceDocument } from "../ingestion/store.js";
import { search } from "./search.js";

const dbUp = await pool.query("SELECT 1").then(
  () => true,
  () => false,
);

/** A vector with the given weights on the first axes and zero elsewhere. */
const axes = (...weights: number[]): number[] => {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  weights.forEach((w, i) => (v[i] = w));
  return v;
};

const cleanup = () =>
  pool.query("DELETE FROM chunks WHERE url LIKE 'testsearch://%'");

describe.skipIf(!dbUp)("search", () => {
  beforeAll(async () => {
    await cleanup();
    const chunk = (text: string, i: number) => ({
      text,
      title: `title ${text}`,
      alertName: `alert ${text}`,
      chunkIndex: i,
    });
    await replaceDocument(
      pool,
      {
        source: "test",
        url: "testsearch://doc",
        license: "MIT",
        docHash: "h",
        chunks: [chunk("exact", 0), chunk("near", 1), chunk("opposite", 2)],
      },
      [axes(1, 0), axes(1, 1), axes(-1, 0)],
    );
  });
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  const ask = (k: number) =>
    search(pool, "anything", {
      k,
      embed: async () => ({ embeddings: [axes(1, 0)], totalTokens: 1 }),
    });

  it("returns the closest chunk first, with distance 0 for the same direction", async () => {
    const [first, second] = await ask(2);
    expect(first?.text).toBe("exact");
    expect(first?.distance).toBeCloseTo(0, 5);
    expect(second?.text).toBe("near");
    // 45 degrees apart: cosine similarity 0.7071, so distance about 0.2929
    expect(second?.distance).toBeCloseTo(0.2929, 3);
  });

  it("returns the citation fields along with the text", async () => {
    const [first] = await ask(1);
    expect(first).toMatchObject({
      source: "test",
      url: "testsearch://doc",
      license: "MIT",
      title: "title exact",
      alertName: "alert exact",
      chunkIndex: 0,
    });
  });

  it("respects k", async () => {
    expect(await ask(3)).toHaveLength(3);
  });

  it("asks for a query embedding, not a document embedding", async () => {
    let seen: string | undefined;
    await search(pool, "q", {
      k: 1,
      embed: async (_texts, options) => {
        seen = options.inputType;
        return { embeddings: [axes(1, 0)], totalTokens: 1 };
      },
    });
    expect(seen).toBe("query");
  });
});

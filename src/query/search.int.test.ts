// Integration test: needs the Postgres container. Only touches rows whose url starts with "testsearch://".
// The test vectors point along single axes, which real embeddings essentially never do,
// so the real rows in the table cannot outrank them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db/client.js";
import { EMBEDDING_DIMENSIONS } from "../ingestion/embed.js";
import { replaceDocument } from "../ingestion/store.js";
import { hybridSearch } from "./hybrid.js";
import { search, searchFullText } from "./search.js";

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

  describe("searchFullText", () => {
    // Made-up words ("zxqvortex", "flange") so no real chunk can match them.
    beforeAll(async () => {
      const chunk = (text: string, i: number) => ({
        text,
        title: `title ${i}`,
        alertName: null,
        chunkIndex: i,
      });
      await replaceDocument(
        pool,
        {
          source: "test",
          url: "testsearch://fts",
          license: "MIT",
          docHash: "h",
          chunks: [
            chunk("zxqvortex zxqvortex flange", 0),
            chunk("zxqvortex gasket", 1),
            chunk("nothing relevant here", 2),
          ],
        },
        // Vectors do not matter for keyword search; any valid vector will do.
        [axes(0, 0, 1), axes(0, 0, 1), axes(0, 0, 1)],
      );
    });

    it("ranks the chunk with more matching words first", async () => {
      const results = await searchFullText(pool, "zxqvortex flange");
      expect(results.map((r) => r.chunkIndex)).toEqual([0, 1]);
      expect(results[0]!.rank).toBeGreaterThan(results[1]!.rank);
    });

    it("treats key=value and -word as plain words, not as 'adjacent' or 'NOT'", async () => {
      await replaceDocument(
        pool,
        {
          source: "test",
          url: "testsearch://fts2",
          license: "MIT",
          docHash: "h",
          chunks: [
            {
              text: "zxqalpha alone",
              title: "a",
              alertName: null,
              chunkIndex: 0,
            },
            {
              text: "zxqbeta alone",
              title: "b",
              alertName: null,
              chunkIndex: 1,
            },
          ],
        },
        [axes(0, 0, 1), axes(0, 0, 1)],
      );
      // Postgres reads "a=b" as the PHRASE "a <-> b" (adjacent words), and "-b" as NOT b.
      // Neither is what a pasted alert or a casual question means: every word is just a word.
      for (const question of ["zxqalpha=zxqbeta", "zxqalpha -zxqbeta"]) {
        const results = await searchFullText(pool, question);
        expect(results.map((r) => r.chunkIndex).sort(), question).toEqual([
          0, 1,
        ]);
        expect(results.every((r) => r.url === "testsearch://fts2")).toBe(true);
      }
    });

    it("matches on ANY word: a word that appears nowhere does not rule a chunk out", async () => {
      const results = await searchFullText(
        pool,
        "zxqvortex flange wordthatexistsnowhere",
      );
      expect(results.map((r) => r.chunkIndex)).toEqual([0, 1]);
    });

    it("matches stems, not exact words", async () => {
      // "flanges" is cut to the stem "flang", the same stem as "flange" in the chunk.
      const results = await searchFullText(pool, "flanges");
      expect(results.map((r) => r.chunkIndex)).toEqual([0]);
    });

    it("returns an empty list when nothing matches, and when the question is only stop words", async () => {
      expect(await searchFullText(pool, "wordthatexistsnowhere")).toEqual([]);
      expect(await searchFullText(pool, "the of and")).toEqual([]);
    });

    it("returns the citation fields and respects k", async () => {
      const results = await searchFullText(pool, "zxqvortex", { k: 1 });
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        source: "test",
        url: "testsearch://fts",
        license: "MIT",
      });
    });
  });

  describe("hybridSearch", () => {
    // The question vector is axes(1, 0), so a chunk's vector distance is set by the vector we give it.
    // "zxqhybrid" is a made-up word, so only our test chunks can match it by keywords.
    beforeAll(async () => {
      const chunk = (text: string, i: number) => ({
        text,
        title: `title ${i}`,
        alertName: null,
        chunkIndex: i,
      });
      await replaceDocument(
        pool,
        {
          source: "test",
          url: "testsearch://hyb",
          license: "MIT",
          docHash: "h",
          chunks: [
            chunk("zxqhybrid", 0), // keywords match + near in meaning: both lists
            chunk("filler words only", 1), // identical direction (best vector hit), no keyword match
            chunk("zxqhybrid", 2), // keywords match + the opposite direction (distance 2)
          ],
        },
        [axes(1, 1), axes(1, 0), axes(-1, 0)],
      );
    });

    const ask = (k = 5) =>
      hybridSearch(pool, "zxqhybrid", {
        k,
        embed: async () => ({ embeddings: [axes(1, 0)], totalTokens: 1 }),
      });

    it("ranks a chunk found by BOTH searchers above a chunk found by only one", async () => {
      const results = await ask();
      const byIndex = (i: number) =>
        results.find((r) => r.url === "testsearch://hyb" && r.chunkIndex === i);
      // chunk 0 is in both lists; chunk 1 is a vector-only hit
      expect(results[0]?.url).toBe("testsearch://hyb");
      expect(results[0]?.chunkIndex).toBe(0);
      expect(byIndex(0)?.vectorRank).not.toBeNull();
      expect(byIndex(0)?.textRank).not.toBeNull();
      expect(byIndex(1)?.textRank).toBeNull();
    });

    it("keeps a chunk only the keyword search found, with distance null", async () => {
      // Distance 2 is the worst possible, so with thousands of real rows it is outside the vector top 20.
      const found = (await ask()).find(
        (r) => r.url === "testsearch://hyb" && r.chunkIndex === 2,
      );
      expect(found).toBeDefined();
      expect(found?.vectorRank).toBeNull();
      expect(found?.distance).toBeNull();
      expect(found?.textRank).not.toBeNull();
    });

    it("returns the citation fields, a distance for vector hits, and respects k", async () => {
      const results = await ask(2);
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        source: "test",
        license: "MIT",
        title: "title 0",
      });
      expect(results[0]?.distance).toBeCloseTo(0.2929, 3);
    });
  });
});

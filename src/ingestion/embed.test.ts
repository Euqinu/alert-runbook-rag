import { describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS, embedTexts } from "./embed.js";

const vec = (n: number): number[] =>
  new Array<number>(EMBEDDING_DIMENSIONS).fill(n);

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

/** Fake Voyage: text "t7" gets an embedding filled with 7, so we can check order. */
function fakeVoyage(tokensPerCall = 10) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const { input } = JSON.parse(init.body as string) as { input: string[] };
    return jsonResponse({
      data: input.map((t, index) => ({
        index,
        embedding: vec(Number(t.slice(1))),
      })),
      usage: { total_tokens: tokensPerCall },
    });
  });
}

const texts = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `t${i}`);
const base = {
  inputType: "document" as const,
  apiKey: "test-key",
  sleepFn: async () => {},
};

describe("embedTexts", () => {
  it("splits into batches and keeps the input order", async () => {
    const fetchFn = fakeVoyage();
    const { embeddings } = await embedTexts(texts(130), { ...base, fetchFn });

    const sizes = fetchFn.mock.calls.map(
      ([, init]) => (JSON.parse(init.body as string).input as string[]).length,
    );
    expect(sizes).toEqual([64, 64, 2]);
    expect(embeddings.map((e) => e[0])).toEqual(
      Array.from({ length: 130 }, (_, i) => i),
    );
  });

  it("sums the tokens reported by each call", async () => {
    const { totalTokens } = await embedTexts(texts(130), {
      ...base,
      fetchFn: fakeVoyage(7),
    });
    expect(totalTokens).toBe(21);
  });

  it("puts results back in input order even if the API returns them shuffled", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: [
          { index: 1, embedding: vec(11) },
          { index: 0, embedding: vec(10) },
        ],
        usage: { total_tokens: 2 },
      }),
    );
    const { embeddings } = await embedTexts(["a", "b"], { ...base, fetchFn });
    expect(embeddings.map((e) => e[0])).toEqual([10, 11]);
  });

  it("sends the model, input_type, dimension, truncation=false and the auth header", async () => {
    const fetchFn = fakeVoyage();
    await embedTexts(["t1"], { ...base, inputType: "query", fetchFn });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "voyage-4-lite",
      input_type: "query",
      output_dimension: 1024,
      truncation: false,
    });
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key",
    );
  });

  it("returns nothing and makes no call for an empty list", async () => {
    const fetchFn = fakeVoyage();
    expect(await embedTexts([], { ...base, fetchFn })).toEqual({
      embeddings: [],
      totalTokens: 0,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects empty texts before calling the API", async () => {
    const fetchFn = fakeVoyage();
    await expect(
      embedTexts(["ok", "  "], { ...base, fetchFn }),
    ).rejects.toThrow("input index 1");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("retries a 429 and honours Retry-After", async () => {
    const good = fakeVoyage();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: "slow down" }, 429, { "retry-after": "3" }),
      )
      .mockImplementation(good);
    const sleepFn = vi.fn<(ms: number) => Promise<void>>(async () => {});

    const { embeddings } = await embedTexts(["t5"], {
      ...base,
      fetchFn,
      sleepFn,
    });

    expect(embeddings[0]?.[0]).toBe(5);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledWith(3000);
  });

  it("backs off exponentially on 500s and on network errors", async () => {
    const good = fakeVoyage();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockImplementation(good);
    const sleepFn = vi.fn<(ms: number) => Promise<void>>(async () => {});

    await embedTexts(["t1"], { ...base, fetchFn, sleepFn });

    expect(sleepFn.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  });

  it("gives up after maxRetries and says why", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ detail: "overloaded" }, 503),
    );
    await expect(
      embedTexts(["t1"], { ...base, fetchFn, maxRetries: 2 }),
    ).rejects.toThrow(/HTTP 503.*overloaded/);
    expect(fetchFn).toHaveBeenCalledTimes(3); // first try + 2 retries
  });

  it("does not retry a 401 (a retry would fail the same way)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ detail: "bad key" }, 401));
    await expect(embedTexts(["t1"], { ...base, fetchFn })).rejects.toThrow(
      "HTTP 401",
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("never puts the API key in an error message", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ detail: "nope" }, 401));
    const error = await embedTexts(["t1"], {
      ...base,
      apiKey: "super-secret-key",
      fetchFn,
    }).catch((e: Error) => e);
    expect((error as Error).message).not.toContain("super-secret-key");
  });

  it("fails if the API returns the wrong number of embeddings", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: [{ index: 0, embedding: vec(1) }],
        usage: { total_tokens: 1 },
      }),
    );
    await expect(embedTexts(["a", "b"], { ...base, fetchFn })).rejects.toThrow(
      "1 embeddings for 2 texts",
    );
  });

  it("fails if an embedding has the wrong dimension", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        data: [{ index: 0, embedding: [1, 2, 3] }],
        usage: { total_tokens: 1 },
      }),
    );
    await expect(embedTexts(["a"], { ...base, fetchFn })).rejects.toThrow(
      "Expected 1024 dimensions but got 3",
    );
  });
});

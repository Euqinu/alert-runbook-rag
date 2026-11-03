import { config } from "../config.js";

export const EMBEDDING_MODEL = "voyage-4-lite";
/** Must match the `vector(1024)` column in migrations/001_init.sql. */
export const EMBEDDING_DIMENSIONS = 1024;

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface EmbedOptions {
  /** "document" for chunks we store, "query" for a user's question. */
  inputType: "document" | "query";
  /** Texts per API call. Voyage allows up to 1,000; 64 is a conservative choice. */
  batchSize?: number;
  /** Retries per batch after a temporary failure (429, 5xx, network error). */
  maxRetries?: number;
  // The four options below exist so tests can run without the network or real waiting.
  apiKey?: string;
  fetchFn?: FetchFn;
  sleepFn?: (ms: number) => Promise<void>;
}

export interface EmbedResult {
  /** One vector per input text, in the same order as the input. */
  embeddings: number[][];
  /** Tokens billed across all calls, as reported by the API. */
  totalTokens: number;
}

interface VoyageResponse {
  data: { index: number; embedding: number[] }[];
  usage: { total_tokens: number };
}

export async function embedTexts(
  texts: string[],
  options: EmbedOptions,
): Promise<EmbedResult> {
  const batchSize = options.batchSize ?? 64;
  const maxRetries = options.maxRetries ?? 5;
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn =
    options.sleepFn ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const blank = texts.findIndex((t) => t.trim() === "");
  if (blank !== -1)
    throw new Error(`Cannot embed an empty text (input index ${blank})`);

  const embeddings: number[][] = [];
  let totalTokens = 0;

  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    const apiKey = options.apiKey ?? config.voyageApiKey;
    const response = await callWithRetry(
      batch,
      options.inputType,
      apiKey,
      fetchFn,
      sleepFn,
      maxRetries,
    );
    embeddings.push(...checkAndOrder(response, batch.length));
    totalTokens += response.usage.total_tokens;
  }
  return { embeddings, totalTokens };
}

async function callWithRetry(
  batch: string[],
  inputType: "document" | "query",
  apiKey: string,
  fetchFn: FetchFn,
  sleepFn: (ms: number) => Promise<void>,
  maxRetries: number,
): Promise<VoyageResponse> {
  const init: RequestInit = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: batch,
      model: EMBEDDING_MODEL,
      input_type: inputType,
      output_dimension: EMBEDDING_DIMENSIONS,
      // The default (true) silently cuts over-long texts. We want a loud error instead.
      truncation: false,
    }),
  };

  for (let attempt = 0; ; attempt++) {
    let res: Response | undefined;
    let failure: string;
    try {
      res = await fetchFn(VOYAGE_URL, init);
      if (res.ok) return (await res.json()) as VoyageResponse;
      failure = `HTTP ${res.status}`;
    } catch (err) {
      failure = `network error: ${err instanceof Error ? err.message : String(err)}`;
    }

    // 429 = rate limited, 5xx = server trouble, no response = network trouble: worth retrying.
    // Any other status (400 bad request, 401 bad key, ...) will fail the same way again.
    const retryable =
      res === undefined || res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= maxRetries) {
      const body = res ? ` - ${(await res.text()).slice(0, 300)}` : "";
      throw new Error(`Voyage embeddings request failed (${failure})${body}`);
    }
    await sleepFn(backoffMs(attempt, res?.headers.get("retry-after") ?? null));
  }
}

/** Honour the server's Retry-After (seconds) if given, else 0.5s, 1s, 2s, 4s... capped at 30s. */
function backoffMs(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter === null ? NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1000, 60_000);
  return Math.min(500 * 2 ** attempt, 30_000);
}

/** Make sure the API gave back exactly what we asked for, in input order. */
function checkAndOrder(
  response: VoyageResponse,
  expectedCount: number,
): number[][] {
  if (response.data.length !== expectedCount) {
    throw new Error(
      `Voyage returned ${response.data.length} embeddings for ${expectedCount} texts`,
    );
  }
  const ordered = [...response.data].sort((a, b) => a.index - b.index);
  return ordered.map((item) => {
    if (item.embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Expected ${EMBEDDING_DIMENSIONS} dimensions but got ${item.embedding.length}`,
      );
    }
    return item.embedding;
  });
}

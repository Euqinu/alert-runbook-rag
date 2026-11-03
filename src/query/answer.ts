import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { NOT_FOUND, SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";
import type { SearchResult } from "./search.js";

export const GENERATION_MODEL = "claude-sonnet-5-5";

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type CreateFn = (params: CreateParams) => Promise<Anthropic.Beta.BetaMessage>;

export interface Answer {
  /** The model's reply (empty if the request was refused). */
  text: string;
  /** The model said the runbooks don't contain the answer. */
  notFound: boolean;
  /** The safety classifiers declined to answer. */
  refused: boolean;
  /** Output hit max_tokens, so the answer may be cut off. */
  truncated: boolean;
  /** Source numbers [n] the answer cites that really exist, ascending. */
  citations: number[];
  /** Cited numbers that point at no source (a sign of a made-up citation). */
  invalidCitations: number[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** Which [n] markers does the text contain? Splits them into real sources and non-existent ones. */
export function extractCitations(
  text: string,
  sourceCount: number,
): { valid: number[]; invalid: number[] } {
  const found = new Set<number>();
  for (const m of text.matchAll(/\[(\d+)\]/g)) found.add(Number(m[1]));
  const sorted = [...found].sort((a, b) => a - b);
  return {
    valid: sorted.filter((n) => n >= 1 && n <= sourceCount),
    invalid: sorted.filter((n) => n < 1 || n > sourceCount),
  };
}

/** Ask Claude to answer `question` using only `results` (the retrieved chunks). */
export async function generateAnswer(
  question: string,
  results: SearchResult[],
  options: { create?: CreateFn } = {},
): Promise<Answer> {
  const create: CreateFn =
    options.create ??
    ((params) =>
      new Anthropic({ apiKey: config.anthropicApiKey }).beta.messages.create(
        params,
      ));

  const response = await create({
    model: GENERATION_MODEL,
    max_tokens: 16000,
    // If the safety classifiers decline, let the API retry on its recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    // Thinking can't be turned off on this model; effort is the dial. Medium is enough for
    // "read 5 short excerpts and answer". Revisit if the answers measure poorly.
    output_config: { effort: "medium" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(question, results) }],
  });

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
  const base = { model: response.model, usage };

  // A refusal is a normal HTTP 200 with no usable content: check before reading it.
  if (response.stop_reason === "refusal") {
    return {
      ...base,
      text: "",
      notFound: false,
      refused: true,
      truncated: false,
      citations: [],
      invalidCitations: [],
    };
  }

  const text = response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
  const { valid, invalid } = extractCitations(text, results.length);

  return {
    ...base,
    text,
    notFound: text.startsWith(NOT_FOUND),
    refused: false,
    truncated: response.stop_reason === "max_tokens",
    citations: valid,
    invalidCitations: invalid,
  };
}

import type { ChunkDraft } from "./types.js";

export interface MarkdownChunkOptions {
  /** Max characters per chunk, including the context prefix. */
  maxChars: number;
  /** Max characters repeated from the end of one chunk at the start of the next. */
  overlapChars: number;
}

export const DEFAULT_MARKDOWN_OPTIONS: MarkdownChunkOptions = {
  maxChars: 1500,
  overlapChars: 150,
};

/** Room reserved for the body even if a heading path is very long. */
const MIN_BODY_CHARS = 200;

interface Section {
  path: string[];
  body: string;
}

/**
 * Heading-based chunking for markdown runbooks.
 *
 * 1. Split into sections at every heading (ignoring `#` lines inside code fences).
 * 2. Prefix each chunk with "docTitle > heading path", because a leaf heading such
 *    as "Grafana" is meaningless on its own.
 * 3. A section that fits in `maxChars` is one chunk. A longer one is split on
 *    paragraph boundaries (code blocks stay whole when they fit) with overlap.
 */
export function chunkMarkdown(
  markdown: string,
  docTitle: string,
  options: MarkdownChunkOptions = DEFAULT_MARKDOWN_OPTIONS,
): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];

  for (const section of splitSections(stripFrontMatter(markdown))) {
    if (section.body === "") continue; // heading with no text of its own

    const title = [docTitle, ...section.path].join(" > ");
    const budget = Math.max(
      options.maxChars - title.length - 2,
      MIN_BODY_CHARS,
    );

    for (const body of splitBody(section.body, budget, options.overlapChars)) {
      chunks.push({
        text: `${title}\n\n${body}`,
        title,
        alertName: null,
        chunkIndex: chunks.length,
      });
    }
  }
  return chunks;
}

function stripFrontMatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(markdown);
  return match ? markdown.slice(match[0].length) : markdown;
}

/** Tracks whether we are inside a fenced code block (``` or ~~~, 3+ chars). */
class FenceTracker {
  private open: string | null = null;

  /** Feed one line. Returns true if the line is a fence line or inside a fence. */
  inCode(line: string): boolean {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
    if (this.open === null) {
      if (marker === null) return false;
      this.open = marker;
      return true;
    }
    const closes =
      marker !== null &&
      marker[0] === this.open[0] &&
      marker.length >= this.open.length &&
      line.trim() === marker;
    if (closes) this.open = null;
    return true;
  }
}

function splitSections(markdown: string): Section[] {
  const sections: Section[] = [];
  const stack: { level: number; text: string }[] = [];
  const fence = new FenceTracker();
  let lines: string[] = [];

  const flush = (): void => {
    sections.push({
      path: stack.map((h) => h.text),
      body: lines.join("\n").trim(),
    });
    lines = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = fence.inCode(line)
      ? null
      : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level)
        stack.pop();
      stack.push({ level, text: heading[2]! });
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

interface Unit {
  text: string;
  /** Separator placed before this unit when it joins the previous one. */
  sep: string;
}

/** Split a section body into pieces of at most `budget` chars, with overlap. */
function splitBody(
  body: string,
  budget: number,
  overlapChars: number,
): string[] {
  if (body.length <= budget) return [body];

  const out: string[] = [];
  let current = "";

  const emit = (): void => {
    if (current.trim() !== "") out.push(current);
  };

  for (const unit of toUnits(body, budget)) {
    const joined = current === "" ? unit.text : current + unit.sep + unit.text;
    if (joined.length <= budget) {
      current = joined;
      continue;
    }
    emit();
    const tail = overlapTail(current, overlapChars);
    const withTail = tail === "" ? unit.text : tail + unit.sep + unit.text;
    current = withTail.length <= budget ? withTail : unit.text;
  }
  emit();
  return out;
}

/** Paragraph units (code fences kept whole); oversized ones are cut into line units. */
function toUnits(body: string, budget: number): Unit[] {
  const units: Unit[] = [];
  for (const block of splitBlocks(body)) {
    if (block.length <= budget) {
      units.push({ text: block, sep: "\n\n" });
      continue;
    }
    for (const line of block.split("\n")) {
      for (let i = 0; i < Math.max(line.length, 1); i += budget) {
        units.push({ text: line.slice(i, i + budget), sep: "\n" });
      }
    }
  }
  return units;
}

/** Blank-line separated blocks; blank lines inside a code fence do not split. */
function splitBlocks(body: string): string[] {
  const blocks: string[] = [];
  const fence = new FenceTracker();
  let current: string[] = [];

  for (const line of body.split("\n")) {
    if (!fence.inCode(line) && line.trim() === "") {
      if (current.length > 0) blocks.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

/**
 * The end of `text`, at most `maxChars` long: whole lines when they fit.
 * If even the last line is too long (a prose paragraph on one line), fall back
 * to its last `maxChars` characters, starting at a word boundary.
 */
function overlapTail(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  const kept: string[] = [];
  let size = 0;
  for (const line of text.split("\n").reverse()) {
    if (size + line.length + 1 > maxChars) break;
    kept.unshift(line);
    size += line.length + 1;
  }
  if (kept.length > 0) return kept.join("\n").trim();

  const tail = text.slice(-maxChars);
  const firstSpace = tail.search(/\s/);
  return (firstSpace === -1 ? tail : tail.slice(firstSpace)).trim();
}

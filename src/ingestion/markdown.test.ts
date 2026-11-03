import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "./markdown.js";

const opts = { maxChars: 1500, overlapChars: 150 };
const FENCE = "```";

describe("chunkMarkdown", () => {
  it("prefixes each chunk with the doc title and the full heading path", () => {
    const md =
      "# Troubleshooting\n\n## Is redis running?\n\n### Grafana\n\nCheck the dashboard.\n";
    const chunks = chunkMarkdown(md, "redis/redis.md", opts);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.title).toBe(
      "redis/redis.md > Troubleshooting > Is redis running? > Grafana",
    );
    expect(chunks[0]?.text).toBe(
      "redis/redis.md > Troubleshooting > Is redis running? > Grafana\n\nCheck the dashboard.",
    );
  });

  it("pops the heading path when a sibling or higher heading starts", () => {
    const md = "# A\n\n## B\n\nb text\n\n## C\n\nc text\n\n# D\n\nd text\n";
    expect(chunkMarkdown(md, "d", opts).map((c) => c.title)).toEqual([
      "d > A > B",
      "d > A > C",
      "d > D",
    ]);
  });

  it("skips headings that have no text of their own", () => {
    const md = "# Title\n\n## Empty parent\n\n### Child\n\nbody\n";
    expect(chunkMarkdown(md, "d", opts).map((c) => c.title)).toEqual([
      "d > Title > Empty parent > Child",
    ]);
  });

  it("does not treat '#' lines inside a code fence as headings", () => {
    const md = `# Script\n\n${FENCE}ruby\n# Hash to store grouped keys\nx = {}\n${FENCE}\n\nafter\n`;
    const chunks = chunkMarkdown(md, "d", opts);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("# Hash to store grouped keys");
    expect(chunks[0]?.text).toContain("after");
  });

  it("strips YAML front matter", () => {
    const md = "---\ntitle: x\n---\n# Real\n\nbody\n";
    const chunks = chunkMarkdown(md, "d", opts);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).not.toContain("title: x");
  });

  it("splits a long section on paragraphs, within maxChars, with overlap", () => {
    const paras = Array.from({ length: 12 }, (_, i) =>
      `Paragraph ${i} ${"word ".repeat(30)}`.trim(),
    );
    const md = `# Long\n\n${paras.join("\n\n")}\n`;
    const small = { maxChars: 600, overlapChars: 150 };
    const chunks = chunkMarkdown(md, "d", small);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length <= small.maxChars)).toBe(true);
    // overlap: each paragraph is one 160+ char line, longer than overlapChars, so the
    // overlap is the word-aligned end of chunk 0's body, repeated at the start of chunk 1's
    const body = (i: number): string =>
      chunks[i]!.text.split("\n\n").slice(1).join("\n\n");
    const overlap = body(1).split("\n\n")[0]!;
    expect(overlap.length).toBeGreaterThan(0);
    expect(overlap.length).toBeLessThanOrEqual(small.overlapChars);
    expect(body(0).endsWith(overlap)).toBe(true);
    // every paragraph survives somewhere
    for (const p of paras)
      expect(chunks.some((c) => c.text.includes(p))).toBe(true);
  });

  it("keeps a code block whole when it fits", () => {
    const code = `${FENCE}\n${"line\n".repeat(20)}${FENCE}`;
    const md = `# S\n\n${"intro ".repeat(80)}\n\n${code}\n`;
    const chunks = chunkMarkdown(md, "d", { maxChars: 700, overlapChars: 0 });
    expect(chunks.some((c) => c.text.includes(code))).toBe(true);
  });

  it("hard-splits a single oversized code block and still respects maxChars", () => {
    const md = `# S\n\n${FENCE}\n${"y\n".repeat(400)}${FENCE}\n`;
    const small = { maxChars: 500, overlapChars: 0 };
    const chunks = chunkMarkdown(md, "d", small);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length <= small.maxChars)).toBe(true);
  });

  it("numbers chunks sequentially across sections", () => {
    const md = "# A\n\na\n\n# B\n\nb\n";
    expect(chunkMarkdown(md, "d", opts).map((c) => c.chunkIndex)).toEqual([
      0, 1,
    ]);
  });
});

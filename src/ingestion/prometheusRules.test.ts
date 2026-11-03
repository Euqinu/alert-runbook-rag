import { describe, expect, it } from "vitest";
import { chunkPrometheusRules } from "./prometheusRules.js";

const yaml = `
groups:
  - name: Basic resource monitoring
    services:
      - name: Host and hardware
        exporters:
          - slug: node-exporter
            rules:
              - name: Host out of memory
                description: Node memory is filling up (< 10% left).
                query: "node_memory_MemAvailable_bytes < 100"
                severity: warning
                comments: |
                  Check dmesg for the OOM killer.
              - name: Host high CPU load
                description: CPU load is high.
                query: "cpu > 80"
                severity: warning
      - name: Redis
        exporters:
          - slug: oliver006-redis-exporter
            rules:
              - name: Redis down
                description: Redis instance is down.
                query: "redis_up == 0"
                severity: critical
`;

describe("chunkPrometheusRules", () => {
  const chunks = chunkPrometheusRules(yaml);

  it("makes one chunk per rule, numbered in file order", () => {
    expect(chunks.map((c) => c.alertName)).toEqual([
      "Host out of memory",
      "Host high CPU load",
      "Redis down",
    ]);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
  });

  it("puts name, service context, severity, description and comments in the text", () => {
    expect(chunks[0]?.text).toBe(
      [
        "Alert: Host out of memory",
        "Service: Host and hardware (Basic resource monitoring)",
        "Severity: warning",
        "Node memory is filling up (< 10% left).",
        "Check dmesg for the OOM killer.",
      ].join("\n"),
    );
  });

  it("leaves the PromQL query out of the text", () => {
    expect(
      chunks.every((c) => !c.text.includes("node_memory_MemAvailable_bytes")),
    ).toBe(true);
  });

  it("omits optional lines when comments are missing", () => {
    expect(chunks[1]?.text).not.toContain("undefined");
    expect(chunks[1]?.text.split("\n")).toHaveLength(4);
  });

  it("sets the title to 'group > service'", () => {
    expect(chunks[2]?.title).toBe("Basic resource monitoring > Redis");
  });
});

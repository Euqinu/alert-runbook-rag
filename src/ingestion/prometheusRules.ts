import YAML from "yaml";
import type { ChunkDraft } from "./types.js";

interface Rule {
  name: string;
  description: string;
  severity?: string;
  comments?: string;
}
interface Exporter {
  rules?: Rule[];
}
interface Service {
  name: string;
  exporters?: Exporter[];
}
interface Group {
  name: string;
  services?: Service[];
}
interface RulesFile {
  groups: Group[];
}

/**
 * One chunk per alert rule. Rules are short (max ~570 chars), so there is no
 * size cap and no overlap: splitting would only separate a rule's name from
 * its description. The PromQL `query` is deliberately left out of the text
 * (users search by symptom or alert name, not by metric expression).
 */
export function chunkPrometheusRules(yamlText: string): ChunkDraft[] {
  const file = YAML.parse(yamlText) as RulesFile;
  const chunks: ChunkDraft[] = [];

  for (const group of file.groups) {
    for (const service of group.services ?? []) {
      for (const exporter of service.exporters ?? []) {
        for (const rule of exporter.rules ?? []) {
          chunks.push({
            text: buildText(group.name, service.name, rule),
            title: `${group.name} > ${service.name}`,
            alertName: rule.name,
            chunkIndex: chunks.length,
          });
        }
      }
    }
  }
  return chunks;
}

function buildText(group: string, service: string, rule: Rule): string {
  const lines = [
    `Alert: ${rule.name}`,
    `Service: ${service} (${group})`,
    rule.severity ? `Severity: ${rule.severity}` : null,
    rule.description,
    rule.comments?.trim() || null,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

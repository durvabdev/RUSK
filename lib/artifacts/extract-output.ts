import type { ArtifactOutput } from "./schema";

export type ExtractResult =
  | { ok: true; value: string }
  | { ok: false; code: "output_missing" | "output_ambiguous" };

export function extractDefinition(
  snapshot: string,
  label: string,
): ExtractResult {
  const lines = snapshot.split("\n");
  const labelNorm = label.trim().toLowerCase();
  const values: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const termMatch = line.match(
      /^\s*[\-]*\s*term(?:\s+\[ref=[^\]]+\])?\s*:\s*(.+)$/i,
    );
    if (!termMatch) continue;
    const termText = termMatch[1]!.trim().toLowerCase();
    if (termText !== labelNorm) continue;

    for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
      const defMatch = lines[j]!.match(
        /^\s*[\-]*\s*definition(?:\s+\[ref=[^\]]+\])?\s*:\s*(.+)$/i,
      );
      if (defMatch) {
        values.push(defMatch[1]!.trim());
        break;
      }
    }
  }

  if (values.length === 0) {
    return { ok: false, code: "output_missing" };
  }
  const unique = [...new Set(values)];
  if (unique.length > 1) {
    return { ok: false, code: "output_ambiguous" };
  }
  return { ok: true, value: unique[0]! };
}

export function extractPageText(
  snapshot: string,
  label: string,
): ExtractResult {
  const labelNorm = label.trim().toLowerCase();
  const matches: string[] = [];

  for (const line of snapshot.split("\n")) {
    const idx = line.toLowerCase().indexOf(labelNorm);
    if (idx === -1) continue;
    const after = line.slice(idx + label.length).replace(/^[\s:]+/, "").trim();
    if (after) matches.push(after);
  }

  if (matches.length === 0) {
    return { ok: false, code: "output_missing" };
  }
  const unique = [...new Set(matches)];
  if (unique.length > 1) {
    return { ok: false, code: "output_ambiguous" };
  }
  return { ok: true, value: unique[0]! };
}

export function extractOutput(
  snapshot: string,
  output: ArtifactOutput,
): ExtractResult {
  if (output.extractor.kind === "definition") {
    return extractDefinition(snapshot, output.extractor.label);
  }
  return extractPageText(snapshot, output.extractor.label);
}

export function slugifyOutputName(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

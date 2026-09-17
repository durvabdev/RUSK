import type { BrowserController } from "../browser/browser";
import type { ArtifactValue, ReplayTarget } from "./schema";
import {
  minimalContainersMatchingText,
  nodesInSubtree,
  parseSnapshotCandidates,
  parseSnapshotTree,
  type SnapshotCandidate,
  type SnapshotNode,
} from "./snapshot-parser";

export type ResolveResult =
  | { ok: true; ref: string }
  | { ok: false; code: "target_missing" | "target_ambiguous" };

/** Prefer these when the target has no explicit role. */
const INTERACTIVE_ROLES = new Set([
  "link",
  "button",
  "menuitem",
  "tab",
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "option",
  "textbox",
  "searchbox",
]);

function normalize(s: string | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function resolveValue(
  value: ArtifactValue,
  inputs: Record<string, unknown>,
): string | null {
  if (value.source === "literal") return value.value;
  const raw = inputs[value.name];
  if (typeof raw === "boolean") return raw ? "true" : "false";
  if (typeof raw === "number") return String(raw);
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw;
}

function candidateMatches(
  candidate: SnapshotCandidate,
  target: ReplayTarget,
): boolean {
  // Match on replay selectors only (role/name/text/testId/within).
  if (target.role && normalize(candidate.role) !== normalize(target.role)) {
    return false;
  }
  // testId is authoritative — HTML name attrs often differ from a11y names.
  if (target.testId) {
    return true;
  }
  if (target.name) {
    const name = normalize(candidate.name);
    if (name !== normalize(target.name)) return false;
  }
  if (target.text) {
    const name = normalize(candidate.name ?? candidate.text);
    if (name !== normalize(target.text)) return false;
  }
  if (target.placeholder) {
    // Snapshot candidates rarely expose placeholder; skip soft match here.
  }
  return true;
}

async function filterByTestId(
  matches: SnapshotCandidate[],
  testId: string,
  browser: BrowserController,
): Promise<SnapshotCandidate[]> {
  const verified: SnapshotCandidate[] = [];
  for (const candidate of matches) {
    try {
      const meta = await browser.inspectElement(candidate.ref);
      if (meta.testId === testId) {
        verified.push(candidate);
      }
    } catch {
      /* skip */
    }
  }
  return verified;
}

async function preferVisible(
  matches: SnapshotCandidate[],
  browser: BrowserController,
): Promise<SnapshotCandidate[]> {
  if (matches.length <= 1) return matches;
  const visible: SnapshotCandidate[] = [];
  for (const candidate of matches) {
    try {
      const meta = await browser.inspectElement(candidate.ref);
      if (meta.rect.width > 0 && meta.rect.height > 0 && !meta.disabled) {
        visible.push(candidate);
      }
    } catch {
      /* keep unknown visibility in play only if none inspect */
    }
  }
  return visible.length > 0 ? visible : matches;
}

function preferInteractive(
  matches: SnapshotCandidate[],
  target: ReplayTarget,
): SnapshotCandidate[] {
  if (matches.length <= 1 || target.role) return matches;
  const interactive = matches.filter(
    (m) => m.role && INTERACTIVE_ROLES.has(normalize(m.role)),
  );
  return interactive.length > 0 ? interactive : matches;
}

async function finalize(
  matches: SnapshotCandidate[],
  target: ReplayTarget,
  browser: BrowserController,
): Promise<ResolveResult> {
  let narrowed = preferInteractive(matches, target);
  narrowed = await preferVisible(narrowed, browser);

  if (narrowed.length === 0) {
    return { ok: false, code: "target_missing" };
  }
  if (narrowed.length > 1) {
    return { ok: false, code: "target_ambiguous" };
  }
  return { ok: true, ref: narrowed[0]!.ref };
}

export async function resolveTarget(
  target: ReplayTarget,
  snapshot: string,
  browser: BrowserController,
  inputs: Record<string, unknown> = {},
): Promise<ResolveResult> {
  if (target.within?.kind === "matching_container") {
    const matchText = resolveValue(target.within.value, inputs);
    if (matchText === null) {
      return { ok: false, code: "target_missing" };
    }

    const tree = parseSnapshotTree(snapshot);
    const containers = minimalContainersMatchingText(tree, matchText);
    if (containers.length === 0) {
      return { ok: false, code: "target_missing" };
    }
    if (containers.length > 1) {
      return { ok: false, code: "target_ambiguous" };
    }

    const container = containers[0]!;
    const inner = nodesInSubtree(container).filter((n: SnapshotNode) =>
      candidateMatches(n, target),
    );

    let matches: SnapshotCandidate[] = inner;
    if (target.testId) {
      matches = await filterByTestId(matches, target.testId, browser);
    }
    return finalize(matches, target, browser);
  }

  let matches = parseSnapshotCandidates(snapshot).filter((c) =>
    candidateMatches(c, target),
  );

  if (target.testId) {
    matches = await filterByTestId(matches, target.testId, browser);
  }

  return finalize(matches, target, browser);
}

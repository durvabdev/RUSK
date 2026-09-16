import type { BrowserController } from "../browser/browser";
import type { ReplayTarget } from "./schema";
import {
  parseSnapshotCandidates,
  type SnapshotCandidate,
} from "./snapshot-parser";

export type ResolveResult =
  | { ok: true; ref: string }
  | { ok: false; code: "target_missing" | "target_ambiguous" };

function normalize(s: string | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function candidateMatches(
  candidate: SnapshotCandidate,
  target: ReplayTarget,
): boolean {
  if (target.role && normalize(candidate.role) !== normalize(target.role)) {
    return false;
  }
  if (target.name) {
    const name = normalize(candidate.name);
    if (name !== normalize(target.name)) return false;
  }
  if (target.text) {
    const name = normalize(candidate.name);
    if (name !== normalize(target.text)) return false;
  }
  if (target.href && candidate.href !== target.href) {
    return false;
  }
  return true;
}

export async function resolveTarget(
  target: ReplayTarget,
  snapshot: string,
  browser: BrowserController,
): Promise<ResolveResult> {
  let matches = parseSnapshotCandidates(snapshot).filter((c) =>
    candidateMatches(c, target),
  );

  if (target.testId) {
    const verified: SnapshotCandidate[] = [];
    for (const candidate of matches) {
      try {
        const meta = await browser.inspectElement(candidate.ref);
        if (meta.testId === target.testId) {
          verified.push(candidate);
        }
      } catch {
        /* skip */
      }
    }
    matches = verified;
  }

  if (matches.length === 0) {
    return { ok: false, code: "target_missing" };
  }
  if (matches.length > 1) {
    return { ok: false, code: "target_ambiguous" };
  }
  return { ok: true, ref: matches[0]!.ref };
}

export type SnapshotCandidate = {
  ref: string;
  role?: string;
  name?: string;
  text?: string;
  href?: string;
};

/**
 * Parse MCP accessibility snapshot lines such as:
 * - link "Member" [ref=f4e21]
 * - searchbox "Member ID or name" [ref=f5e34]
 */
export function parseSnapshotCandidates(snapshot: string): SnapshotCandidate[] {
  const candidates: SnapshotCandidate[] = [];

  for (const line of snapshot.split("\n")) {
    const refMatch = line.match(/\[ref=([^\]]+)\]/);
    if (!refMatch) continue;

    const ref = refMatch[1]!.trim();
    const roleMatch = line.match(
      /^\s*[\-]*\s*(\w+)\s+(?:"[^"]*"|'[^']*'|\S)/,
    );
    const quotedMatch = line.match(/"([^"]*)"/) ?? line.match(/'([^']*)'/);
    const role = roleMatch?.[1]?.toLowerCase();
    const name = quotedMatch?.[1]?.trim();

    const candidate: SnapshotCandidate = { ref };
    if (role && role !== "ref") candidate.role = role;
    if (name) candidate.name = name;

    const hrefMatch = line.match(/href:\s*(\S+)/i);
    if (hrefMatch) candidate.href = hrefMatch[1];

    candidates.push(candidate);
  }

  return candidates;
}

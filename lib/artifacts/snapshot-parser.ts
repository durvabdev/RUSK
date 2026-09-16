export type SnapshotCandidate = {
  ref: string;
  role?: string;
  name?: string;
  text?: string;
  href?: string;
};

export type SnapshotNode = SnapshotCandidate & {
  depth: number;
  lineIndex: number;
  children: SnapshotNode[];
  parent: SnapshotNode | null;
};

/**
 * Parse MCP accessibility snapshot lines such as:
 * - link "Member" [ref=f4e21]
 * - searchbox "Member ID or name" [ref=f5e34]
 */
export function parseSnapshotCandidates(snapshot: string): SnapshotCandidate[] {
  return parseSnapshotTree(snapshot).flatMap(flattenCandidates);
}

function flattenCandidates(node: SnapshotNode): SnapshotCandidate[] {
  const { depth: _d, lineIndex: _i, children, parent: _p, ...candidate } = node;
  return [candidate, ...children.flatMap(flattenCandidates)];
}

function lineDepth(line: string): number {
  const match = line.match(/^(\s*)/);
  return match?.[1]?.length ?? 0;
}

function parseLine(line: string, lineIndex: number): SnapshotNode | null {
  const refMatch = line.match(/\[ref=([^\]]+)\]/);
  if (!refMatch) return null;

  const ref = refMatch[1]!.trim();
  const roleMatch = line.match(
    /^\s*[\-]*\s*(\w+)\s+(?:"[^"]*"|'[^']*'|\S)/,
  );
  const quotedMatch = line.match(/"([^"]*)"/) ?? line.match(/'([^']*)'/);
  const role = roleMatch?.[1]?.toLowerCase();
  const name = quotedMatch?.[1]?.trim();

  const node: SnapshotNode = {
    ref,
    depth: lineDepth(line),
    lineIndex,
    children: [],
    parent: null,
  };
  if (role && role !== "ref") node.role = role;
  if (name) node.name = name;

  const hrefMatch = line.match(/href:\s*(\S+)/i);
  if (hrefMatch) node.href = hrefMatch[1];

  return node;
}

/** Build an indented a11y tree from an MCP snapshot. */
export function parseSnapshotTree(snapshot: string): SnapshotNode[] {
  const roots: SnapshotNode[] = [];
  const stack: SnapshotNode[] = [];

  const lines = snapshot.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const node = parseLine(line, i);
    if (node) {
      while (stack.length > 0 && stack[stack.length - 1]!.depth >= node.depth) {
        stack.pop();
      }

      if (stack.length === 0) {
        roots.push(node);
      } else {
        const parent = stack[stack.length - 1]!;
        node.parent = parent;
        parent.children.push(node);
      }
      stack.push(node);
      continue;
    }

    // Attach unref'd quoted text to the current parent (common in a11y dumps).
    const depth = lineDepth(line);
    let parent: SnapshotNode | null = null;
    for (let j = stack.length - 1; j >= 0; j -= 1) {
      if (stack[j]!.depth < depth) {
        parent = stack[j]!;
        break;
      }
    }
    if (!parent) continue;
    const quoted = line.match(/"([^"]*)"/) ?? line.match(/'([^']*)'/);
    if (quoted?.[1]) {
      const t = quoted[1].trim();
      parent.text = parent.text ? `${parent.text} ${t}` : t;
    }
  }

  return roots;
}

export function nodesInSubtree(root: SnapshotNode): SnapshotNode[] {
  return [root, ...root.children.flatMap(nodesInSubtree)];
}

export function subtreeText(root: SnapshotNode): string {
  return nodesInSubtree(root)
    .map((n) => [n.name, n.text].filter(Boolean).join(" "))
    .join(" ")
    .toLowerCase();
}

const CONTAINER_ROLES = new Set([
  "row",
  "listitem",
  "group",
  "article",
  "list",
  "table",
  "grid",
  "treeitem",
]);

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** True if haystack contains needle as a whole phrase (not a prefix of a longer token). */
export function containsPhrase(haystack: string, needle: string): boolean {
  const n = normalize(needle);
  if (!n) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // \b so "elena varga" does not match inside "elena vargas"
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

/**
 * Minimal containers whose subtree contains `text`.
 * Prefer semantic container roles; otherwise any node that is not an ancestor
 * of another match.
 */
export function minimalContainersMatchingText(
  tree: SnapshotNode[],
  text: string,
): SnapshotNode[] {
  const needle = normalize(text);
  if (!needle) return [];

  const all: SnapshotNode[] = [];
  for (const root of tree) {
    all.push(...nodesInSubtree(root));
  }

  const containing = all.filter((n) => containsPhrase(subtreeText(n), needle));
  if (containing.length === 0) return [];

  // Prefer nodes with container roles when available.
  const withRole = containing.filter(
    (n) => n.role && CONTAINER_ROLES.has(n.role),
  );
  const pool = withRole.length > 0 ? withRole : containing;

  // Keep minimal (deepest): drop any node that is an ancestor of another match.
  return pool.filter((n) => {
    const descendants = nodesInSubtree(n).slice(1);
    return !descendants.some((d) => pool.includes(d));
  });
}

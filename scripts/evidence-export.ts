#!/usr/bin/env npx tsx
/**
 * Copy real discovery/replay run logs + artifact into /evidence/.
 *
 * Usage:
 *   npm run evidence:export -- \
 *     --discovery-run <id> \
 *     --replay-success <id> \
 *     --replay-exception <id> \
 *     --artifact <artifactId>
 */
import fs from "node:fs/promises";
import path from "node:path";

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

function usage(): never {
  console.error(`Usage:
  npm run evidence:export -- \\
    --discovery-run <id> \\
    --replay-success <id> \\
    --replay-exception <id> \\
    --artifact <artifactId>`);
  process.exit(1);
}

export async function exportEvidence(opts: {
  discoveryRunId: string;
  successRunId: string;
  exceptionRunId: string;
  artifactId: string;
  cwd?: string;
}): Promise<{ evidenceDir: string; copied: string[] }> {
  const root = opts.cwd ?? process.cwd();
  const runsDir =
    process.env.RUSK_RUNS_DIR ?? path.join(root, ".rusk", "runs");
  const artifactsDir = path.join(root, ".rusk", "artifacts");
  const evidenceDir = path.join(root, "evidence");

  const artifactSrc = path.join(artifactsDir, `${opts.artifactId}.json`);
  const discoveryEvents = path.join(
    runsDir,
    opts.discoveryRunId,
    "events.jsonl",
  );
  const successEvents = path.join(runsDir, opts.successRunId, "events.jsonl");
  const exceptionEvents = path.join(
    runsDir,
    opts.exceptionRunId,
    "events.jsonl",
  );
  const exceptionPng = path.join(runsDir, opts.exceptionRunId, "failure.png");

  for (const file of [artifactSrc, discoveryEvents, successEvents, exceptionEvents]) {
    try {
      await fs.access(file);
    } catch {
      throw new Error(`Missing required source file: ${file}`);
    }
  }

  await fs.mkdir(evidenceDir, { recursive: true });
  const copied: string[] = [];

  async function copy(src: string, destName: string) {
    const dest = path.join(evidenceDir, destName);
    await fs.copyFile(src, dest);
    copied.push(destName);
  }

  await copy(artifactSrc, "capability.json");
  await copy(discoveryEvents, "discovery-run.jsonl");
  await copy(successEvents, "replay-success.jsonl");
  await copy(exceptionEvents, "replay-exception.jsonl");

  let hasPng = false;
  try {
    await fs.access(exceptionPng);
    await copy(exceptionPng, "replay-exception.png");
    hasPng = true;
  } catch {
    /* optional */
  }

  const readme = `# Evidence

- capability.json
  Artifact produced by the genuine LLM discovery run (\`${opts.artifactId}\`).

- discovery-run.jsonl
  Structured observe/decide/act evidence from discovery run \`${opts.discoveryRunId}\`.

- replay-success.jsonl
  Deterministic replay (no LLM) — success run \`${opts.successRunId}\`.

- replay-exception.jsonl
  Exceptional replay (business_outcome / recoverable / failure) — run \`${opts.exceptionRunId}\`.

- replay-exception.png
  ${hasPng ? "Screenshot from the exceptional replay run." : "Not present for this export (capture failed or unsupported)."}

## Commands used

\`\`\`bash
# Discovery (note runId + artifactId from response)
curl -s -X POST http://localhost:3000/api/runs \\
  -H 'content-type: application/json' \\
  -d '{"url":"https://dough-credit-union.vercel.app","goal":"<goal>"}'

# Replay (note runId from response)
curl -s -X POST http://localhost:3000/api/artifacts/<artifactId>/run \\
  -H 'content-type: application/json' \\
  -d '{"inputs":{...}}'

npm run evidence:export -- \\
  --discovery-run ${opts.discoveryRunId} \\
  --replay-success ${opts.successRunId} \\
  --replay-exception ${opts.exceptionRunId} \\
  --artifact ${opts.artifactId}
\`\`\`
`;

  await fs.writeFile(path.join(evidenceDir, "README.md"), readme, "utf8");
  copied.push("README.md");

  return { evidenceDir, copied };
}

async function main() {
  const discoveryRunId = argValue("--discovery-run");
  const successRunId = argValue("--replay-success");
  const exceptionRunId = argValue("--replay-exception");
  const artifactId = argValue("--artifact");
  if (!discoveryRunId || !successRunId || !exceptionRunId || !artifactId) {
    usage();
  }

  try {
    const { evidenceDir, copied } = await exportEvidence({
      discoveryRunId,
      successRunId,
      exceptionRunId,
      artifactId,
    });
    console.log(`Exported to ${evidenceDir}:`);
    for (const name of copied) console.log(`  ${name}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("evidence-export.ts") ||
    process.argv[1].endsWith("evidence-export.js"));

if (isMain) {
  void main();
}

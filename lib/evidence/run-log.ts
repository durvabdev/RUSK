import fs from "node:fs/promises";
import path from "node:path";
import { sanitizeForEvidence } from "./sanitize";

export function getRunsDir(): string {
  return (
    process.env.RUSK_RUNS_DIR ??
    path.join(process.cwd(), ".rusk", "runs")
  );
}

export function getRunDir(runId: string): string {
  return path.join(getRunsDir(), runId);
}

async function ensureRunDir(runId: string): Promise<string> {
  const dir = getRunDir(runId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export type RunMeta = {
  kind: "discovery" | "replay";
  runId: string;
  artifactId?: string;
  status?: string;
  createdAt: string;
  updatedAt?: string;
};

export async function writeRunMeta(
  runId: string,
  meta: {
    kind: "discovery" | "replay";
    artifactId?: string;
    status?: string;
  },
): Promise<void> {
  const dir = await ensureRunDir(runId);
  const file = path.join(dir, "meta.json");
  let existing: Partial<RunMeta> = {};
  try {
    existing = JSON.parse(await fs.readFile(file, "utf8")) as Partial<RunMeta>;
  } catch {
    /* new */
  }
  const next: RunMeta = {
    kind: meta.kind,
    runId,
    createdAt: existing.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(meta.artifactId !== undefined
      ? { artifactId: meta.artifactId }
      : existing.artifactId
        ? { artifactId: existing.artifactId }
        : {}),
    ...(meta.status !== undefined
      ? { status: meta.status }
      : existing.status
        ? { status: existing.status }
        : {}),
  };
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export async function appendRunEvent(
  runId: string,
  event: Record<string, unknown>,
): Promise<void> {
  const dir = await ensureRunDir(runId);
  const file = path.join(dir, "events.jsonl");
  const sanitized = sanitizeForEvidence(event) as Record<string, unknown>;
  const line = {
    timestamp: new Date().toISOString(),
    runId,
    ...sanitized,
  };
  await fs.appendFile(file, `${JSON.stringify(line)}\n`, "utf8");
}

export function failureScreenshotPath(runId: string): string {
  return path.join(getRunDir(runId), "failure.png");
}

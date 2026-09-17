import type { ArtifactRunResult } from "./schema";

export type ReplayRunStatus =
  | "running"
  | "waiting_for_human"
  | "success"
  | "business_outcome"
  | "failed";

export type ReplayRun = {
  runId: string;
  artifactId: string;
  inputs: Record<string, unknown>;
  /** 0-based index into artifact.steps */
  stepIndex: number;
  status: ReplayRunStatus;
  lastError?: ArtifactRunResult;
  createdAt: number;
  updatedAt: number;
};

const g = globalThis as typeof globalThis & {
  ruskReplayRuns?: Map<string, ReplayRun>;
};

function store(): Map<string, ReplayRun> {
  if (!g.ruskReplayRuns) {
    g.ruskReplayRuns = new Map();
  }
  return g.ruskReplayRuns;
}

export function createReplayRun(partial: {
  runId: string;
  artifactId: string;
  inputs: Record<string, unknown>;
}): ReplayRun {
  const now = Date.now();
  const run: ReplayRun = {
    runId: partial.runId,
    artifactId: partial.artifactId,
    inputs: partial.inputs,
    stepIndex: 0,
    status: "running",
    createdAt: now,
    updatedAt: now,
  };
  store().set(run.runId, run);
  return run;
}

export function getReplayRun(runId: string): ReplayRun | null {
  return store().get(runId) ?? null;
}

export function saveReplayRun(run: ReplayRun): void {
  run.updatedAt = Date.now();
  store().set(run.runId, run);
}

/**
 * Process-global browser session ownership.
 * Ensures a paused HUMAN handoff cannot be overwritten by another discovery/replay
 * unless the operator explicitly starts a new run (supersede).
 */

export type BrowserControl = {
  mode: "automation" | "human";
  runId: string | null;
};

export class BrowserControlError extends Error {
  readonly code = "browser_busy";

  constructor(message: string) {
    super(message);
    this.name = "BrowserControlError";
  }
}

const g = globalThis as typeof globalThis & {
  ruskBrowserControl?: BrowserControl;
};

function state(): BrowserControl {
  if (!g.ruskBrowserControl) {
    g.ruskBrowserControl = { mode: "automation", runId: null };
  }
  return g.ruskBrowserControl;
}

export function getBrowserControl(): BrowserControl {
  const s = state();
  return { mode: s.mode, runId: s.runId };
}

export type ClaimAutomationResult = {
  supersededRunId: string | null;
  supersededMode: "automation" | "human" | null;
};

/**
 * Claim the browser for a new automation run.
 * With supersede (default true for explicit new runs), abandons any prior owner
 * so "Run workflow again" is not blocked by a paused HUMAN handoff.
 */
export function claimAutomation(
  runId: string,
  options: { supersede?: boolean } = {},
): ClaimAutomationResult {
  const supersede = options.supersede !== false;
  const s = state();

  if (s.runId !== null && s.runId !== runId) {
    if (!supersede) {
      throw new BrowserControlError(
        s.mode === "human"
          ? `Browser is waiting for human on run ${s.runId}`
          : `Browser is busy with run ${s.runId}`,
      );
    }
    const result: ClaimAutomationResult = {
      supersededRunId: s.runId,
      supersededMode: s.mode,
    };
    g.ruskBrowserControl = { mode: "automation", runId };
    return result;
  }

  g.ruskBrowserControl = { mode: "automation", runId };
  return { supersededRunId: null, supersededMode: null };
}

/** Pause automation and hand the live session to a human for this run. */
export function transferToHuman(runId: string): void {
  const s = state();
  if (s.runId !== runId) {
    throw new BrowserControlError(
      `Cannot transfer browser to human: owned by ${s.runId ?? "nobody"}`,
    );
  }
  g.ruskBrowserControl = { mode: "human", runId };
}

/** Resume automation for a run that was waiting for human. */
export function resumeAutomation(runId: string): void {
  const s = state();
  if (s.mode !== "human" || s.runId !== runId) {
    throw new BrowserControlError(
      s.mode === "human"
        ? `Browser is waiting for a different run (${s.runId})`
        : `Browser is not waiting for human (run ${s.runId ?? "none"})`,
    );
  }
  g.ruskBrowserControl = { mode: "automation", runId };
}

/** Release ownership so another run can claim. */
export function releaseBrowserControl(runId?: string): void {
  const s = state();
  if (runId !== undefined && s.runId !== null && s.runId !== runId) {
    return;
  }
  g.ruskBrowserControl = { mode: "automation", runId: null };
}

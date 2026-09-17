import { z } from "zod";
import type { BrowserController, BrowserObservation } from "../browser/browser";
import {
  claimAutomation,
  releaseBrowserControl,
  resumeAutomation,
  transferToHuman,
} from "../browser/control";
import type { HumanRequest } from "../agent/human-request";
import {
  appendRunEvent,
  failureScreenshotPath,
  writeRunMeta,
} from "../evidence/run-log";
import { matchApprovalRule } from "../policy/approval";
import { getPolicyConfig } from "../policy/config";
import {
  evaluateActionPolicy,
  type PolicyElementMeta,
} from "../policy/evaluate";
import type {
  ArtifactCondition,
  ArtifactRunResult,
  ArtifactValue,
  ReplayContext,
  ReplayStep,
  ReplayTarget,
  TextPresent,
  WorkflowArtifact,
} from "./schema";
import { WorkflowArtifactSchema } from "./schema";
import { extractOutput } from "./extract-output";
import { resolveTarget } from "./resolve-target";
import {
  createReplayRun,
  getReplayRun,
  saveReplayRun,
  type ReplayRun,
} from "./replay-run";
import { createArtifactRepository } from "./repository";

export const DEFAULT_POLL_INTERVAL_MS = 250;
export const DEFAULT_POLL_TIMEOUT_MS = 5000;

export type ReplayOptions = {
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  runId?: string;
};

export type ReplayRecoverableError = Extract<
  ArtifactRunResult,
  { status: "recoverable" }
>;

export type ReplayWaitingResult = {
  status: "waiting_for_human";
  runId: string;
  stepIndex: number;
  humanRequest: HumanRequest;
  replayError: ReplayRecoverableError;
};

/** Terminal success / business_outcome / failure, or pause for HUMAN. */
export type ReplaySessionResult =
  | Exclude<ArtifactRunResult, { status: "recoverable" }>
  | ReplayWaitingResult;

function resolveValue(
  value: ArtifactValue,
  inputs: Record<string, unknown>,
): string | null {
  if (value.source === "literal") return value.value;
  const raw = inputs[value.name];
  if (typeof raw === "boolean") return raw ? "true" : "false";
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "string" && raw.trim()) return raw;
  return null;
}

/** True when a missing input should skip the step (optional, leave page as-is). */
function shouldSkipOptionalInput(
  value: ArtifactValue,
  inputDefs: WorkflowArtifact["inputs"],
): boolean {
  if (value.source !== "input") return false;
  const def = inputDefs[value.name];
  return Boolean(def && !def.required);
}

function parseCheckedDesired(raw: string): boolean | string {
  const lower = raw.trim().toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") return true;
  if (lower === "false" || lower === "0" || lower === "no") return false;
  return raw.trim();
}

function applyInputDefaults(
  inputs: Record<string, unknown>,
  defs: WorkflowArtifact["inputs"],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...inputs };
  for (const [name, def] of Object.entries(defs)) {
    const cur = out[name];
    const blank =
      cur === undefined ||
      cur === null ||
      (typeof cur === "string" && !cur.trim());
    if (blank && def.default !== undefined) {
      out[name] = def.default;
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function policyFailure(
  code: string,
  message: string,
  context?: ReplayContext,
): Extract<ArtifactRunResult, { status: "failure" }> {
  return {
    status: "failure",
    code,
    message,
    context,
  };
}

async function elementMetaForPolicy(
  browser: BrowserController,
  ref: string,
): Promise<PolicyElementMeta | null> {
  try {
    const el = await browser.inspectElement(ref);
    return {
      risk: el.risk,
      actionCategory: el.actionCategory,
      role: el.role,
      name: el.name,
      href: el.href,
      type: el.type,
      text: el.text,
      tag: el.tag,
    };
  } catch {
    return null;
  }
}

function checkPolicy(input: {
  action: string;
  currentUrl?: string | null;
  navigateUrl?: string | null;
  element?: PolicyElementMeta | null;
  key?: string | null;
  stepIndex?: number;
  /** Artifact semantic target — preferred for approval role/name. */
  stepTarget?: {
    role?: string | null;
    name?: string | null;
    text?: string | null;
  } | null;
}):
  | Extract<ArtifactRunResult, { status: "failure" | "recoverable" }>
  | null {
  const decision = evaluateActionPolicy(input, getPolicyConfig());

  // Hard denials only — ignore classifier policy_requires_human in replay.
  if (
    !decision.ok &&
    decision.code !== "policy_requires_human"
  ) {
    return policyFailure(decision.code, decision.message, {
      stepIndex: input.stepIndex,
      action: input.action,
    });
  }

  const el = input.element;
  const st = input.stepTarget;
  const approval = matchApprovalRule(input.action, {
    role: el?.role ?? st?.role ?? null,
    name: st?.name ?? el?.name ?? null,
    text: el?.text ?? st?.text ?? null,
    tag: el?.tag ?? null,
  });
  if (approval) {
    return {
      status: "recoverable",
      code: "policy_requires_human",
      message: approval.reason,
      retryable: true,
      context: {
        stepIndex: input.stepIndex,
        action: input.action,
      },
    };
  }
  return null;
}

/** Sanitized snapshot summary — no input values / typed secrets. */
export function summarizeObserved(snapshot: string): string {
  const compact = snapshot.replace(/\s+/g, " ").trim();
  if (compact.length <= 160) return compact;
  return `${compact.slice(0, 157)}...`;
}

export function matchCondition(
  snapshot: string,
  conditions: ArtifactCondition[],
): ArtifactCondition | null {
  const haystack = snapshot.toLowerCase();
  for (const condition of conditions) {
    if (condition.when.kind !== "text_present") continue;
    if (haystack.includes(condition.when.text.toLowerCase())) {
      return condition;
    }
  }
  return null;
}

function textPresent(snapshot: string, check: TextPresent): boolean {
  return snapshot.toLowerCase().includes(check.text.toLowerCase());
}

function summarizeTarget(target: ReplayTarget): string {
  const parts: string[] = [];
  if (target.role) parts.push(`role=${target.role}`);
  if (target.name) parts.push(`name=${target.name}`);
  if (target.text) parts.push(`text=${target.text}`);
  if (target.testId) parts.push(`testId=${target.testId}`);
  if (target.within) parts.push("within=matching_container");
  return parts.join(" ") || "target";
}

function contextFrom(
  partial: ReplayContext,
  observation?: BrowserObservation,
): ReplayContext {
  return {
    ...partial,
    ...(observation?.url ? { currentUrl: observation.url } : {}),
    ...(partial.observed === undefined && observation
      ? { observed: summarizeObserved(observation.snapshot) }
      : {}),
  };
}

function conditionResult(
  condition: ArtifactCondition,
  ctx?: ReplayContext,
): ArtifactRunResult {
  if (condition.class === "business_outcome") {
    return {
      status: "business_outcome",
      code: condition.code,
      message: condition.message,
      ...(ctx ? { context: ctx } : {}),
    };
  }
  return {
    status: "recoverable",
    code: condition.code,
    message: condition.message,
    retryable: true,
    ...(ctx ? { context: ctx } : {}),
  };
}

/**
 * Bounded deterministic recovery for recoverable conditions.
 * v1: no handlers registered — always returns false (escalate to HUMAN).
 */
function tryDeterministicRecovery(_condition: ArtifactCondition): boolean {
  return false;
}

async function captureNonSuccessScreenshot(
  browser: BrowserController,
  runId: string,
): Promise<void> {
  if (!browser.screenshot) return;
  try {
    await browser.screenshot(failureScreenshotPath(runId));
  } catch {
    /* soft-fail */
  }
}

async function finishReplay(
  run: ReplayRun,
  browser: BrowserController,
  result: Exclude<ArtifactRunResult, { status: "recoverable" }>,
): Promise<Exclude<ArtifactRunResult, { status: "recoverable" }>> {
  if (result.status === "success") {
    run.status = "success";
    await appendRunEvent(run.runId, {
      event: "replay_finished",
      status: "success",
      outputs: result.outputs,
    });
  } else if (result.status === "business_outcome") {
    run.status = "business_outcome";
    await appendRunEvent(run.runId, {
      event: "replay_finished",
      status: "business_outcome",
      code: result.code,
      message: result.message,
      context: result.context ?? null,
    });
    await captureNonSuccessScreenshot(browser, run.runId);
  } else {
    run.status = "failed";
    await appendRunEvent(run.runId, {
      event: "replay_finished",
      status: "failure",
      code: result.code,
      message: result.message,
      context: result.context ?? null,
    });
    await captureNonSuccessScreenshot(browser, run.runId);
  }

  saveReplayRun(run);
  await writeRunMeta(run.runId, {
    kind: "replay",
    artifactId: run.artifactId,
    status: run.status,
  });
  releaseBrowserControl(run.runId);
  return result;
}

const POLICY_APPROVAL_HUMAN_MESSAGE =
  "Approval required. Perform this action in the live browser, then resume replay.";

async function pauseForHuman(
  run: ReplayRun,
  browser: BrowserController,
  error: ReplayRecoverableError,
): Promise<ReplayWaitingResult> {
  run.status = "waiting_for_human";
  run.lastError = error;
  saveReplayRun(run);

  const evidenceStep = run.stepIndex + 1;
  await appendRunEvent(run.runId, {
    event: "human_escalation",
    artifactId: run.artifactId,
    stepIndex: evidenceStep,
    code: error.code,
    message: error.message,
    currentUrl: error.context?.currentUrl ?? null,
  });
  await writeRunMeta(run.runId, {
    kind: "replay",
    artifactId: run.artifactId,
    status: "waiting_for_human",
  });
  await captureNonSuccessScreenshot(browser, run.runId);

  transferToHuman(run.runId);

  const humanRequest: HumanRequest = {
    type: error.code === "policy_requires_human" ? "approval" : "input",
    message:
      error.code === "policy_requires_human"
        ? POLICY_APPROVAL_HUMAN_MESSAGE
        : "Replay could not continue safely at the current step. Please inspect and correct the live browser state, then resume.",
  };

  return {
    status: "waiting_for_human",
    runId: run.runId,
    stepIndex: run.stepIndex,
    humanRequest,
    replayError: error,
  };
}

function asRecoverable(result: ArtifactRunResult): ReplayRecoverableError | null {
  if (result.status !== "recoverable") return null;
  return result;
}

/**
 * When HUMAN corrects search in the live browser, the URL `q` (etc.) often
 * diverges from frozen replay inputs used by within=matching_container.
 * Sync that input from the current URL so scoped resolution can succeed.
 */
function syncWithinInputFromUrl(
  run: ReplayRun,
  step: ReplayStep,
  currentUrl: string,
): { synced: boolean; inputName?: string; from?: string; to?: string } {
  if (!("target" in step) || !step.target.within) {
    return { synced: false };
  }
  const withinVal = step.target.within.value;
  if (withinVal.source !== "input") return { synced: false };

  let q: string | null = null;
  try {
    const u = new URL(currentUrl);
    q =
      u.searchParams.get("q") ??
      u.searchParams.get("query") ??
      u.searchParams.get("search");
  } catch {
    return { synced: false };
  }
  if (!q?.trim()) return { synced: false };

  const name = withinVal.name;
  const prev = run.inputs[name];
  const prevStr =
    typeof prev === "string" ? prev : prev == null ? "" : String(prev);
  const next = q.trim();
  if (prevStr.trim().toLowerCase() === next.toLowerCase()) {
    return { synced: false };
  }
  run.inputs[name] = next;
  saveReplayRun(run);
  return { synced: true, inputName: name, from: prevStr, to: next };
}

/**
 * Handle a step/condition ArtifactRunResult:
 * - business_outcome / failure → terminal
 * - recoverable + deterministic recovery → null (caller retries)
 * - recoverable → waiting_for_human
 */
async function settleStepResult(
  run: ReplayRun,
  browser: BrowserController,
  result: ArtifactRunResult,
  condition?: ArtifactCondition,
): Promise<ReplaySessionResult | null> {
  if (result.status === "business_outcome" || result.status === "failure") {
    return finishReplay(run, browser, result);
  }
  if (result.status === "success") {
    return finishReplay(run, browser, result);
  }

  const recoverable = asRecoverable(result);
  if (!recoverable) {
    return finishReplay(run, browser, {
      status: "failure",
      code: "step_failed",
      message: "Unexpected replay result",
    });
  }

  if (condition && tryDeterministicRecovery(condition)) {
    // Bounded recovery applied — caller should retry same step.
    return null;
  }

  return pauseForHuman(run, browser, recoverable);
}

export type ArtifactTool = {
  name: string;
  description: string;
  inputSchema: z.ZodType<Record<string, unknown>>;
  invoke(inputs: Record<string, unknown>): Promise<ReplaySessionResult>;
};

export function createArtifactTool(
  artifact: WorkflowArtifact,
  browser: BrowserController,
): ArtifactTool {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, def] of Object.entries(artifact.inputs)) {
    const base =
      def.type === "boolean"
        ? z.union([z.boolean(), z.string()])
        : z.string();
    shape[key] = base.optional();
  }

  const inputSchema = z.object(shape);

  return {
    name: artifact.name,
    description: artifact.description,
    inputSchema,
    invoke: (inputs) => replayArtifact(artifact, inputs, browser),
  };
}

type ResolvePollResult =
  | { kind: "ok"; ref: string; observation: BrowserObservation }
  | { kind: "condition"; condition: ArtifactCondition; observation: BrowserObservation }
  | { kind: "ambiguous"; observation: BrowserObservation }
  | { kind: "missing"; observation: BrowserObservation };

async function resolveWithPoll(
  browser: BrowserController,
  target: ReplayTarget,
  inputs: Record<string, unknown>,
  conditions: ArtifactCondition[],
  options: { intervalMs: number; timeoutMs: number },
): Promise<ResolvePollResult> {
  const deadline = Date.now() + options.timeoutMs;
  let lastObservation = await browser.observe();

  for (;;) {
    const matched = matchCondition(lastObservation.snapshot, conditions);
    if (matched) {
      return { kind: "condition", condition: matched, observation: lastObservation };
    }

    const resolved = await resolveTarget(
      target,
      lastObservation.snapshot,
      browser,
      inputs,
    );

    if (resolved.ok) {
      return { kind: "ok", ref: resolved.ref, observation: lastObservation };
    }
    if (resolved.code === "target_ambiguous") {
      return { kind: "ambiguous", observation: lastObservation };
    }

    if (Date.now() >= deadline) {
      return { kind: "missing", observation: lastObservation };
    }

    await sleep(options.intervalMs);
    lastObservation = await browser.observe();
  }
}

async function waitForCheckpoint(
  browser: BrowserController,
  checkpoint: TextPresent,
  conditions: ArtifactCondition[],
  options: { intervalMs: number; timeoutMs: number },
): Promise<
  | { kind: "ok"; observation: BrowserObservation }
  | { kind: "condition"; condition: ArtifactCondition; observation: BrowserObservation }
  | { kind: "timeout"; observation: BrowserObservation }
> {
  const deadline = Date.now() + options.timeoutMs;
  let lastObservation = await browser.observe();

  for (;;) {
    const matched = matchCondition(lastObservation.snapshot, conditions);
    if (matched) {
      return { kind: "condition", condition: matched, observation: lastObservation };
    }
    if (textPresent(lastObservation.snapshot, checkpoint)) {
      return { kind: "ok", observation: lastObservation };
    }
    if (Date.now() >= deadline) {
      return { kind: "timeout", observation: lastObservation };
    }
    await sleep(options.intervalMs);
    lastObservation = await browser.observe();
  }
}

type StepExecResult =
  | { kind: "ok"; currentUrl: string }
  | { kind: "outcome"; result: ArtifactRunResult; condition?: ArtifactCondition };

async function executeReplayStep(
  step: ReplayStep,
  ctx: {
    run: ReplayRun;
    artifact: WorkflowArtifact;
    browser: BrowserController;
    effectiveInputs: Record<string, unknown>;
    conditions: ArtifactCondition[];
    poll: { intervalMs: number; timeoutMs: number };
    currentUrl: string;
    evidenceStep: number;
  },
): Promise<StepExecResult> {
  const {
    browser,
    effectiveInputs,
    conditions,
    poll,
    artifact,
    evidenceStep,
  } = ctx;
  let currentUrl = ctx.currentUrl;

  if (step.action === "navigate") {
    await appendRunEvent(ctx.run.runId, {
      event: "step_started",
      stepIndex: evidenceStep,
      action: "navigate",
      target: { url: step.url },
    });
    const blocked = checkPolicy({
      action: "navigate",
      navigateUrl: step.url,
      stepIndex: evidenceStep,
    });
    if (blocked) return { kind: "outcome", result: blocked };
    await browser.navigate(step.url);
    currentUrl = step.url;
    await appendRunEvent(ctx.run.runId, {
      event: "step_finished",
      stepIndex: evidenceStep,
      result: "ok",
    });
    return { kind: "ok", currentUrl };
  }

  if (step.action === "press_key") {
    await appendRunEvent(ctx.run.runId, {
      event: "step_started",
      stepIndex: evidenceStep,
      action: "press_key",
      target: { key: step.key },
    });
    const blocked = checkPolicy({
      action: "press_key",
      currentUrl,
      key: step.key,
      stepIndex: evidenceStep,
    });
    if (blocked) return { kind: "outcome", result: blocked };
    await browser.pressKey(step.key);
    await appendRunEvent(ctx.run.runId, {
      event: "step_finished",
      stepIndex: evidenceStep,
      result: "ok",
    });
    return { kind: "ok", currentUrl };
  }

  await appendRunEvent(ctx.run.runId, {
    event: "step_started",
    stepIndex: evidenceStep,
    action: step.action,
    target: step.target,
  });

  const polled = await resolveWithPoll(
    browser,
    step.target,
    effectiveInputs,
    conditions,
    poll,
  );

  if (polled.kind === "condition") {
    await appendRunEvent(ctx.run.runId, {
      event: "condition_detected",
      class: polled.condition.class,
      code: polled.condition.code,
      stepIndex: evidenceStep,
    });
    return {
      kind: "outcome",
      result: conditionResult(
        polled.condition,
        contextFrom(
          {
            stepIndex: evidenceStep,
            action: step.action,
            expected: summarizeTarget(step.target),
          },
          polled.observation,
        ),
      ),
      condition: polled.condition,
    };
  }

  if (polled.kind === "ambiguous") {
    await appendRunEvent(ctx.run.runId, {
      event: "target_resolution",
      stepIndex: evidenceStep,
      result: "target_ambiguous",
    });
    return {
      kind: "outcome",
      result: {
        status: "recoverable",
        code: "target_ambiguous",
        message: `Could not resolve ${step.action} target (target_ambiguous)`,
        retryable: true,
        context: contextFrom(
          {
            stepIndex: evidenceStep,
            action: step.action,
            expected: summarizeTarget(step.target),
          },
          polled.observation,
        ),
      },
    };
  }

  if (polled.kind === "missing") {
    await appendRunEvent(ctx.run.runId, {
      event: "target_resolution",
      stepIndex: evidenceStep,
      result: "target_missing",
    });
    return {
      kind: "outcome",
      result: {
        status: "recoverable",
        code: "target_missing",
        message: `Could not resolve ${step.action} target (target_missing)`,
        retryable: true,
        context: contextFrom(
          {
            stepIndex: evidenceStep,
            action: step.action,
            expected: summarizeTarget(step.target),
          },
          polled.observation,
        ),
      },
    };
  }

  await appendRunEvent(ctx.run.runId, {
    event: "target_resolution",
    stepIndex: evidenceStep,
    result: "resolved",
  });

  currentUrl = polled.observation.url ?? currentUrl;
  const element = await elementMetaForPolicy(browser, polled.ref);
  {
    const policyAction =
      step.action === "set_checked" ? "click" : step.action;
    const blocked = checkPolicy({
      action: policyAction,
      currentUrl,
      element,
      stepIndex: evidenceStep,
      stepTarget: {
        role: step.target.role ?? null,
        name: step.target.name ?? null,
        text: step.target.text ?? null,
      },
    });
    if (blocked) return { kind: "outcome", result: blocked };
  }

  if (step.action === "click") {
    const result = await browser.click(polled.ref);
    if (!result.ok) {
      await appendRunEvent(ctx.run.runId, {
        event: "step_finished",
        stepIndex: evidenceStep,
        result: "error",
      });
      return {
        kind: "outcome",
        result: {
          status: "failure",
          code: "step_failed",
          message: result.text ?? "Click failed",
          context: contextFrom(
            {
              stepIndex: evidenceStep,
              action: "click",
              expected: summarizeTarget(step.target),
            },
            polled.observation,
          ),
        },
      };
    }

    if (step.checkpoint) {
      const cp = await waitForCheckpoint(
        browser,
        step.checkpoint,
        conditions,
        poll,
      );
      if (cp.kind === "condition") {
        await appendRunEvent(ctx.run.runId, {
          event: "condition_detected",
          class: cp.condition.class,
          code: cp.condition.code,
          stepIndex: evidenceStep,
        });
        return {
          kind: "outcome",
          result: conditionResult(
            cp.condition,
            contextFrom(
              {
                stepIndex: evidenceStep,
                action: "click",
                expected: `checkpoint text_present:${step.checkpoint.text}`,
              },
              cp.observation,
            ),
          ),
          condition: cp.condition,
        };
      }
      if (cp.kind === "timeout") {
        await appendRunEvent(ctx.run.runId, {
          event: "checkpoint",
          stepIndex: evidenceStep,
          result: "failed",
        });
        return {
          kind: "outcome",
          result: {
            status: "failure",
            code: "checkpoint_failed",
            message: `Checkpoint not met: text_present "${step.checkpoint.text}"`,
            context: contextFrom(
              {
                stepIndex: evidenceStep,
                action: "click",
                expected: `checkpoint text_present:${step.checkpoint.text}`,
              },
              cp.observation,
            ),
          },
        };
      }
      await appendRunEvent(ctx.run.runId, {
        event: "checkpoint",
        stepIndex: evidenceStep,
        result: "passed",
      });
    }

    await appendRunEvent(ctx.run.runId, {
      event: "step_finished",
      stepIndex: evidenceStep,
      result: "ok",
    });
    return { kind: "ok", currentUrl };
  }

  if (step.action === "type") {
    const text = resolveValue(step.value, effectiveInputs);
    if (text === null) {
      if (shouldSkipOptionalInput(step.value, artifact.inputs)) {
        await appendRunEvent(ctx.run.runId, {
          event: "step_finished",
          stepIndex: evidenceStep,
          result: "skipped_optional",
        });
        return { kind: "ok", currentUrl };
      }
      return {
        kind: "outcome",
        result: {
          status: "failure",
          code: "input_invalid",
          message: `Missing input for type step: ${step.value.source === "input" ? step.value.name : "literal"}`,
          context: {
            stepIndex: evidenceStep,
            action: "type",
            expected: summarizeTarget(step.target),
          },
        },
      };
    }
    const result = await browser.type(polled.ref, text);
    if (!result.ok) {
      await appendRunEvent(ctx.run.runId, {
        event: "step_finished",
        stepIndex: evidenceStep,
        result: "error",
      });
      return {
        kind: "outcome",
        result: {
          status: "failure",
          code: "step_failed",
          message: result.text ?? "Type failed",
          context: contextFrom(
            {
              stepIndex: evidenceStep,
              action: "type",
              expected: summarizeTarget(step.target),
            },
            polled.observation,
          ),
        },
      };
    }
    await appendRunEvent(ctx.run.runId, {
      event: "step_finished",
      stepIndex: evidenceStep,
      result: "ok",
    });
    return { kind: "ok", currentUrl };
  }

  if (step.action === "select") {
    const value = resolveValue(step.value, effectiveInputs);
    if (value === null) {
      if (shouldSkipOptionalInput(step.value, artifact.inputs)) {
        await appendRunEvent(ctx.run.runId, {
          event: "step_finished",
          stepIndex: evidenceStep,
          result: "skipped_optional",
        });
        return { kind: "ok", currentUrl };
      }
      return {
        kind: "outcome",
        result: {
          status: "failure",
          code: "input_invalid",
          message: "Missing input for select step",
          context: {
            stepIndex: evidenceStep,
            action: "select",
            expected: summarizeTarget(step.target),
          },
        },
      };
    }
    const result = await browser.select(polled.ref, value);
    if (!result.ok) {
      await appendRunEvent(ctx.run.runId, {
        event: "step_finished",
        stepIndex: evidenceStep,
        result: "error",
      });
      return {
        kind: "outcome",
        result: {
          status: "failure",
          code: "step_failed",
          message: result.text ?? "Select failed",
          context: contextFrom(
            {
              stepIndex: evidenceStep,
              action: "select",
              expected: summarizeTarget(step.target),
            },
            polled.observation,
          ),
        },
      };
    }
    await appendRunEvent(ctx.run.runId, {
      event: "step_finished",
      stepIndex: evidenceStep,
      result: "ok",
    });
    return { kind: "ok", currentUrl };
  }

  if (step.action === "set_checked") {
    const raw = resolveValue(step.value, effectiveInputs);
    if (raw === null) {
      if (shouldSkipOptionalInput(step.value, artifact.inputs)) {
        await appendRunEvent(ctx.run.runId, {
          event: "step_finished",
          stepIndex: evidenceStep,
          result: "skipped_optional",
        });
        return { kind: "ok", currentUrl };
      }
      return {
        kind: "outcome",
        result: {
          status: "failure",
          code: "input_invalid",
          message: "Missing input for set_checked step",
          context: {
            stepIndex: evidenceStep,
            action: "set_checked",
            expected: summarizeTarget(step.target),
          },
        },
      };
    }

    const desired = parseCheckedDesired(raw);
    let ref = polled.ref;

    if (typeof desired === "string") {
      const optionTarget = {
        ...step.target,
        name: desired,
        text: desired,
      };
      const optionResolved = await resolveTarget(
        optionTarget,
        polled.observation.snapshot,
        browser,
        effectiveInputs,
      );
      if (!optionResolved.ok) {
        return {
          kind: "outcome",
          result: {
            status: "recoverable",
            code:
              optionResolved.code === "target_ambiguous"
                ? "target_ambiguous"
                : "target_missing",
            message: `Could not resolve radio/option "${desired}"`,
            retryable: true,
            context: {
              stepIndex: evidenceStep,
              action: "set_checked",
              expected: desired,
            },
          },
        };
      }
      ref = optionResolved.ref;
    }

    let inspected;
    try {
      inspected = await browser.inspectElement(ref);
    } catch {
      return {
        kind: "outcome",
        result: {
          status: "failure",
          code: "step_failed",
          message: "Could not inspect checkbox/radio for set_checked",
          context: {
            stepIndex: evidenceStep,
            action: "set_checked",
            expected: summarizeTarget(step.target),
          },
        },
      };
    }

    const currentlyChecked = inspected.checked === true;
    const wantChecked = typeof desired === "boolean" ? desired : true;

    if (currentlyChecked !== wantChecked) {
      const result = await browser.click(ref);
      if (!result.ok) {
        await appendRunEvent(ctx.run.runId, {
          event: "step_finished",
          stepIndex: evidenceStep,
          result: "error",
        });
        return {
          kind: "outcome",
          result: {
            status: "failure",
            code: "step_failed",
            message: result.text ?? "set_checked click failed",
            context: contextFrom(
              {
                stepIndex: evidenceStep,
                action: "set_checked",
                expected: summarizeTarget(step.target),
              },
              polled.observation,
            ),
          },
        };
      }
    }

    await appendRunEvent(ctx.run.runId, {
      event: "step_finished",
      stepIndex: evidenceStep,
      result: "ok",
    });
    return { kind: "ok", currentUrl };
  }

  return {
    kind: "outcome",
    result: {
      status: "failure",
      code: "unsupported_action",
      message: `Unsupported replay action`,
      context: { stepIndex: evidenceStep },
    },
  };
}

export async function continueReplay(
  run: ReplayRun,
  artifact: WorkflowArtifact,
  browser: BrowserController,
  options: ReplayOptions = {},
): Promise<ReplaySessionResult> {
  const parsed = WorkflowArtifactSchema.parse(artifact);
  const intervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const poll = { intervalMs, timeoutMs };
  const conditions = parsed.conditions ?? [];
  let effectiveInputs = applyInputDefaults(run.inputs, parsed.inputs);

  run.status = "running";
  saveReplayRun(run);

  let currentUrl = "";
  try {
    const obs = await browser.observe();
    currentUrl = obs.url ?? "";
  } catch {
    currentUrl = parsed.startUrl;
  }

  // Pre-sync within input from live URL before first attempt (resume path).
  {
    const cur = parsed.steps[run.stepIndex];
    if (cur) {
      const sync = syncWithinInputFromUrl(run, cur, currentUrl);
      if (sync.synced) {
        effectiveInputs = applyInputDefaults(run.inputs, parsed.inputs);
        await appendRunEvent(run.runId, {
          event: "deterministic_recovery",
          kind: "sync_within_input",
          inputName: sync.inputName,
          stepIndex: run.stepIndex + 1,
        });
      }
    }
  }

  /** One-shot recovery kinds already tried for the current stepIndex. */
  const attemptedRecovery = new Set<string>();
  let recoveryStepIndex = run.stepIndex;

  while (run.stepIndex < parsed.steps.length) {
    if (recoveryStepIndex !== run.stepIndex) {
      attemptedRecovery.clear();
      recoveryStepIndex = run.stepIndex;
    }

    const step = parsed.steps[run.stepIndex]!;
    const evidenceStep = run.stepIndex + 1;

    const executed = await executeReplayStep(step, {
      run,
      artifact: parsed,
      browser,
      effectiveInputs,
      conditions,
      poll,
      currentUrl,
      evidenceStep,
    });

    if (executed.kind === "ok") {
      currentUrl = executed.currentUrl;
      run.stepIndex += 1;
      saveReplayRun(run);
      continue;
    }

    if (
      executed.result.status === "recoverable" &&
      (executed.result.code === "target_missing" ||
        executed.result.code === "target_ambiguous")
    ) {
      const pageUrl =
        executed.result.context?.currentUrl ?? currentUrl;

      // Recovery 1: sync within-scope input from live URL, then retry.
      if (!attemptedRecovery.has("sync_within_input")) {
        attemptedRecovery.add("sync_within_input");
        const sync = syncWithinInputFromUrl(run, step, pageUrl);
        if (sync.synced) {
          effectiveInputs = applyInputDefaults(run.inputs, parsed.inputs);
          await appendRunEvent(run.runId, {
            event: "deterministic_recovery",
            kind: "sync_within_input",
            inputName: sync.inputName,
            stepIndex: evidenceStep,
          });
          continue;
        }
      }

      // Recovery 2: HUMAN already completed this step — next target resolves.
      if (
        !attemptedRecovery.has("skip_completed_step") &&
        run.stepIndex + 1 < parsed.steps.length
      ) {
        attemptedRecovery.add("skip_completed_step");
        const next = parsed.steps[run.stepIndex + 1]!;
        if ("target" in next) {
          try {
            const obs = await browser.observe();
            currentUrl = obs.url ?? currentUrl;
            const nextResolved = await resolveTarget(
              next.target,
              obs.snapshot,
              browser,
              effectiveInputs,
            );
            if (nextResolved.ok) {
              await appendRunEvent(run.runId, {
                event: "deterministic_recovery",
                kind: "skip_completed_step",
                stepIndex: evidenceStep,
                advancedTo: evidenceStep + 1,
              });
              run.stepIndex += 1;
              saveReplayRun(run);
              continue;
            }
          } catch {
            /* fall through to HUMAN */
          }
        }
      }

      // Recovery 3: drop within scope if the bare target uniquely resolves.
      if (
        !attemptedRecovery.has("relax_within") &&
        "target" in step &&
        step.target.within
      ) {
        attemptedRecovery.add("relax_within");
        const relaxedTarget = { ...step.target };
        delete relaxedTarget.within;
        try {
          const obs = await browser.observe();
          currentUrl = obs.url ?? currentUrl;
          const relaxed = await resolveTarget(
            relaxedTarget,
            obs.snapshot,
            browser,
            effectiveInputs,
          );
          if (relaxed.ok) {
            const relaxedStep = {
              ...step,
              target: relaxedTarget,
            } as ReplayStep;
            await appendRunEvent(run.runId, {
              event: "deterministic_recovery",
              kind: "relax_within",
              stepIndex: evidenceStep,
            });
            const retry = await executeReplayStep(relaxedStep, {
              run,
              artifact: parsed,
              browser,
              effectiveInputs,
              conditions,
              poll,
              currentUrl,
              evidenceStep,
            });
            if (retry.kind === "ok") {
              currentUrl = retry.currentUrl;
              run.stepIndex += 1;
              saveReplayRun(run);
              continue;
            }
            // If relaxed execution still recoverable/fails, settle that result.
            const settledRelaxed = await settleStepResult(
              run,
              browser,
              retry.result,
              retry.condition,
            );
            if (settledRelaxed === null) continue;
            return settledRelaxed;
          }
        } catch {
          /* fall through to HUMAN */
        }
      }
    }

    const settled = await settleStepResult(
      run,
      browser,
      executed.result,
      executed.condition,
    );
    if (settled === null) {
      // Deterministic recovery applied — retry same stepIndex.
      continue;
    }
    return settled;
  }

  const cp = await waitForCheckpoint(
    browser,
    parsed.checkpoint,
    conditions,
    poll,
  );
  if (cp.kind === "condition") {
    await appendRunEvent(run.runId, {
      event: "condition_detected",
      class: cp.condition.class,
      code: cp.condition.code,
    });
    const result = conditionResult(
      cp.condition,
      contextFrom({ action: "checkpoint" }, cp.observation),
    );
    const settled = await settleStepResult(
      run,
      browser,
      result,
      cp.condition,
    );
    if (settled === null) {
      // Recovery on checkpoint condition: re-check checkpoint once.
      return continueReplay(run, parsed, browser, options);
    }
    return settled;
  }
  if (cp.kind === "timeout") {
    await appendRunEvent(run.runId, {
      event: "checkpoint",
      result: "failed",
    });
    return finishReplay(run, browser, {
      status: "failure",
      code: "checkpoint_failed",
      message: `Checkpoint not met: text_present "${parsed.checkpoint.text}"`,
      context: contextFrom(
        {
          action: "checkpoint",
          expected: `checkpoint text_present:${parsed.checkpoint.text}`,
        },
        cp.observation,
      ),
    });
  }

  await appendRunEvent(run.runId, {
    event: "checkpoint",
    result: "passed",
  });

  const outputs: Record<string, string> = {};

  for (const spec of parsed.outputs) {
    const extracted = extractOutput(cp.observation.snapshot, spec);
    if (!extracted.ok) {
      return finishReplay(run, browser, {
        status: "failure",
        code: extracted.code,
        message: `Output ${spec.name}: ${extracted.code}`,
        context: contextFrom(
          {
            action: "extract_outputs",
            expected: `output:${spec.name}`,
          },
          cp.observation,
        ),
      });
    }
    outputs[spec.name] = extracted.value;
  }

  return finishReplay(run, browser, { status: "success", outputs });
}

/** Mark a superseded waiting replay as failed so Resume on the old runId fails cleanly. */
async function abandonSupersededReplay(
  priorRunId: string,
  byRunId: string,
): Promise<void> {
  const prior = getReplayRun(priorRunId);
  if (!prior) return;
  if (
    prior.status !== "waiting_for_human" &&
    prior.status !== "running"
  ) {
    return;
  }
  prior.status = "failed";
  prior.lastError = {
    status: "failure",
    code: "superseded",
    message: `Replay abandoned because a new run started (${byRunId})`,
  };
  saveReplayRun(prior);
  await appendRunEvent(priorRunId, {
    event: "replay_abandoned",
    reason: "superseded",
    byRunId,
  });
  await writeRunMeta(priorRunId, {
    kind: "replay",
    artifactId: prior.artifactId,
    status: "failed",
  });
}

export async function replayArtifact(
  artifact: WorkflowArtifact,
  inputs: Record<string, unknown>,
  browser: BrowserController,
  options: ReplayOptions = {},
): Promise<ReplaySessionResult> {
  const parsed = WorkflowArtifactSchema.parse(artifact);
  const runId = options.runId ?? crypto.randomUUID();

  for (const [name, def] of Object.entries(parsed.inputs)) {
    if (!def.required) continue;
    const v = inputs[name];
    const ok =
      typeof v === "boolean" ||
      (typeof v === "string" && v.trim().length > 0);
    if (!ok) {
      return {
        status: "failure",
        code: "input_invalid",
        message: `Missing required input: ${name}`,
      };
    }
  }

  const claim = claimAutomation(runId, { supersede: true });
  if (claim.supersededRunId) {
    await abandonSupersededReplay(claim.supersededRunId, runId);
  }

  const run = createReplayRun({
    runId,
    artifactId: parsed.id,
    inputs,
  });

  await writeRunMeta(runId, { kind: "replay", artifactId: parsed.id });
  await appendRunEvent(runId, {
    event: "replay_started",
    artifactId: parsed.id,
  });

  {
    const blocked = checkPolicy({
      action: "navigate",
      navigateUrl: parsed.startUrl,
      stepIndex: 0,
    });
    if (blocked) {
      return finishReplay(run, browser, blocked);
    }
  }

  try {
    await browser.navigate(parsed.startUrl);
  } catch (err) {
    releaseBrowserControl(runId);
    run.status = "failed";
    saveReplayRun(run);
    throw err;
  }
  try {
    return await continueReplay(run, parsed, browser, options);
  } catch (err) {
    releaseBrowserControl(runId);
    run.status = "failed";
    saveReplayRun(run);
    throw err;
  }
}

export async function resumeReplay(
  runId: string,
  browser: BrowserController,
  options: ReplayOptions = {},
): Promise<ReplaySessionResult> {
  const run = getReplayRun(runId);
  if (!run) {
    return {
      status: "failure",
      code: "run_missing",
      message: `Replay run not found: ${runId}`,
    };
  }
  if (run.status !== "waiting_for_human") {
    return {
      status: "failure",
      code: "resume_invalid",
      message: `Replay run is not waiting for human (status=${run.status})`,
    };
  }

  resumeAutomation(runId);

  const prior = run.lastError;
  await appendRunEvent(runId, {
    event: "replay_resumed",
    stepIndex: run.stepIndex + 1,
    priorCode:
      prior && "code" in prior ? prior.code : null,
    priorStatus: prior?.status ?? null,
  });

  if (
    prior &&
    prior.status === "recoverable" &&
    prior.code === "policy_requires_human"
  ) {
    // Human performed the gated action in the browser — do not auto-click.
    run.stepIndex += 1;
  }
  run.lastError = undefined;
  run.status = "running";
  saveReplayRun(run);

  const repo = createArtifactRepository();
  const artifact = await repo.get(run.artifactId);
  if (!artifact) {
    run.status = "failed";
    saveReplayRun(run);
    releaseBrowserControl(runId);
    return {
      status: "failure",
      code: "artifact_missing",
      message: `Artifact not found: ${run.artifactId}`,
    };
  }

  try {
    return await continueReplay(run, artifact, browser, {
      ...options,
      runId,
    });
  } catch (err) {
    releaseBrowserControl(runId);
    run.status = "failed";
    saveReplayRun(run);
    throw err;
  }
}

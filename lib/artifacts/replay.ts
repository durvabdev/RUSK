import { z } from "zod";
import type { BrowserController, BrowserObservation } from "../browser/browser";
import {
  appendRunEvent,
  failureScreenshotPath,
  writeRunMeta,
} from "../evidence/run-log";
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
  ReplayTarget,
  TextPresent,
  WorkflowArtifact,
} from "./schema";
import { WorkflowArtifactSchema } from "./schema";
import { extractOutput } from "./extract-output";
import { resolveTarget } from "./resolve-target";

export const DEFAULT_POLL_INTERVAL_MS = 250;
export const DEFAULT_POLL_TIMEOUT_MS = 5000;

export type ReplayOptions = {
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  runId?: string;
};

function resolveValue(
  value: ArtifactValue,
  inputs: Record<string, unknown>,
): string | null {
  if (value.source === "literal") return value.value;
  const raw = inputs[value.name];
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function policyFailure(
  code: string,
  message: string,
  context?: ReplayContext,
): ArtifactRunResult {
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
  stepIndex?: number;
}): ArtifactRunResult | null {
  const decision = evaluateActionPolicy(input, getPolicyConfig());
  if (decision.ok) return null;
  return policyFailure(decision.code, decision.message, {
    stepIndex: input.stepIndex,
    action: input.action,
  });
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
  runId: string,
  artifactId: string,
  browser: BrowserController,
  result: ArtifactRunResult,
): Promise<ArtifactRunResult> {
  if (result.status === "success") {
    await appendRunEvent(runId, {
      event: "replay_finished",
      status: "success",
      outputs: result.outputs,
    });
  } else if (result.status === "business_outcome") {
    await appendRunEvent(runId, {
      event: "replay_finished",
      status: "business_outcome",
      code: result.code,
      message: result.message,
      context: result.context ?? null,
    });
    await captureNonSuccessScreenshot(browser, runId);
  } else if (result.status === "recoverable") {
    await appendRunEvent(runId, {
      event: "replay_finished",
      status: "recoverable",
      code: result.code,
      message: result.message,
      retryable: true,
      context: result.context ?? null,
    });
    await captureNonSuccessScreenshot(browser, runId);
  } else {
    await appendRunEvent(runId, {
      event: "replay_finished",
      status: "failure",
      code: result.code,
      message: result.message,
      context: result.context ?? null,
    });
    await captureNonSuccessScreenshot(browser, runId);
  }

  await writeRunMeta(runId, {
    kind: "replay",
    artifactId,
    status: result.status,
  });
  return result;
}

export type ArtifactTool = {
  name: string;
  description: string;
  inputSchema: z.ZodType<Record<string, unknown>>;
  invoke(
    inputs: Record<string, unknown>,
  ): Promise<ArtifactRunResult>;
};

export function createArtifactTool(
  artifact: WorkflowArtifact,
  browser: BrowserController,
): ArtifactTool {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, def] of Object.entries(artifact.inputs)) {
    shape[key] = def.required
      ? z.string().min(1)
      : z.string().optional();
  }

  const inputSchema = z.object(shape);

  return {
    name: artifact.name,
    description: artifact.description,
    inputSchema,
    invoke: (inputs) =>
      replayArtifact(artifact, inputs, browser),
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

export async function replayArtifact(
  artifact: WorkflowArtifact,
  inputs: Record<string, unknown>,
  browser: BrowserController,
  options: ReplayOptions = {},
): Promise<ArtifactRunResult> {
  const parsed = WorkflowArtifactSchema.parse(artifact);
  const runId = options.runId ?? crypto.randomUUID();
  const intervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const poll = { intervalMs, timeoutMs };
  const conditions = parsed.conditions ?? [];

  await writeRunMeta(runId, { kind: "replay", artifactId: parsed.id });
  await appendRunEvent(runId, {
    event: "replay_started",
    artifactId: parsed.id,
  });

  const done = (result: ArtifactRunResult) =>
    finishReplay(runId, parsed.id, browser, result);

  for (const [name, def] of Object.entries(parsed.inputs)) {
    if (!def.required) continue;
    const v = inputs[name];
    if (typeof v !== "string" || !v.trim()) {
      return done({
        status: "failure",
        code: "input_invalid",
        message: `Missing required input: ${name}`,
      });
    }
  }

  {
    const blocked = checkPolicy({
      action: "navigate",
      navigateUrl: parsed.startUrl,
      stepIndex: 0,
    });
    if (blocked) return done(blocked);
  }
  await browser.navigate(parsed.startUrl);
  let currentUrl = parsed.startUrl;

  let stepIndex = 0;
  for (const step of parsed.steps) {
    stepIndex += 1;

    if (step.action === "navigate") {
      await appendRunEvent(runId, {
        event: "step_started",
        stepIndex,
        action: "navigate",
        target: { url: step.url },
      });
      const blocked = checkPolicy({
        action: "navigate",
        navigateUrl: step.url,
        stepIndex,
      });
      if (blocked) return done(blocked);
      await browser.navigate(step.url);
      currentUrl = step.url;
      await appendRunEvent(runId, {
        event: "step_finished",
        stepIndex,
        result: "ok",
      });
      continue;
    }

    if (step.action === "press_key") {
      await appendRunEvent(runId, {
        event: "step_started",
        stepIndex,
        action: "press_key",
        target: { key: step.key },
      });
      const blocked = checkPolicy({
        action: "press_key",
        currentUrl,
        stepIndex,
      });
      if (blocked) return done(blocked);
      await browser.pressKey(step.key);
      await appendRunEvent(runId, {
        event: "step_finished",
        stepIndex,
        result: "ok",
      });
      continue;
    }

    await appendRunEvent(runId, {
      event: "step_started",
      stepIndex,
      action: step.action,
      target: step.target,
    });

    const polled = await resolveWithPoll(
      browser,
      step.target,
      inputs,
      conditions,
      poll,
    );

    if (polled.kind === "condition") {
      await appendRunEvent(runId, {
        event: "condition_detected",
        class: polled.condition.class,
        code: polled.condition.code,
        stepIndex,
      });
      return done(
        conditionResult(
          polled.condition,
          contextFrom(
            {
              stepIndex,
              action: step.action,
              expected: summarizeTarget(step.target),
            },
            polled.observation,
          ),
        ),
      );
    }

    if (polled.kind === "ambiguous") {
      await appendRunEvent(runId, {
        event: "target_resolution",
        stepIndex,
        result: "target_ambiguous",
      });
      return done({
        status: "failure",
        code: "target_ambiguous",
        message: `Could not resolve ${step.action} target (target_ambiguous)`,
        context: contextFrom(
          {
            stepIndex,
            action: step.action,
            expected: summarizeTarget(step.target),
          },
          polled.observation,
        ),
      });
    }

    if (polled.kind === "missing") {
      await appendRunEvent(runId, {
        event: "target_resolution",
        stepIndex,
        result: "target_missing",
      });
      return done({
        status: "recoverable",
        code: "target_missing",
        message: `Could not resolve ${step.action} target (target_missing)`,
        retryable: true,
        context: contextFrom(
          {
            stepIndex,
            action: step.action,
            expected: summarizeTarget(step.target),
          },
          polled.observation,
        ),
      });
    }

    await appendRunEvent(runId, {
      event: "target_resolution",
      stepIndex,
      result: "resolved",
    });

    currentUrl = polled.observation.url ?? currentUrl;
    const element = await elementMetaForPolicy(browser, polled.ref);
    {
      const blocked = checkPolicy({
        action: step.action,
        currentUrl,
        element,
        stepIndex,
      });
      if (blocked) return done(blocked);
    }

    if (step.action === "click") {
      const result = await browser.click(polled.ref);
      if (!result.ok) {
        await appendRunEvent(runId, {
          event: "step_finished",
          stepIndex,
          result: "error",
        });
        return done({
          status: "failure",
          code: "step_failed",
          message: result.text ?? "Click failed",
          context: contextFrom(
            {
              stepIndex,
              action: "click",
              expected: summarizeTarget(step.target),
            },
            polled.observation,
          ),
        });
      }

      if (step.checkpoint) {
        const cp = await waitForCheckpoint(
          browser,
          step.checkpoint,
          conditions,
          poll,
        );
        if (cp.kind === "condition") {
          await appendRunEvent(runId, {
            event: "condition_detected",
            class: cp.condition.class,
            code: cp.condition.code,
            stepIndex,
          });
          return done(
            conditionResult(
              cp.condition,
              contextFrom(
                {
                  stepIndex,
                  action: "click",
                  expected: `checkpoint text_present:${step.checkpoint.text}`,
                },
                cp.observation,
              ),
            ),
          );
        }
        if (cp.kind === "timeout") {
          await appendRunEvent(runId, {
            event: "checkpoint",
            stepIndex,
            result: "failed",
          });
          return done({
            status: "failure",
            code: "checkpoint_failed",
            message: `Checkpoint not met: text_present "${step.checkpoint.text}"`,
            context: contextFrom(
              {
                stepIndex,
                action: "click",
                expected: `checkpoint text_present:${step.checkpoint.text}`,
              },
              cp.observation,
            ),
          });
        }
        await appendRunEvent(runId, {
          event: "checkpoint",
          stepIndex,
          result: "passed",
        });
      }

      await appendRunEvent(runId, {
        event: "step_finished",
        stepIndex,
        result: "ok",
      });
      continue;
    }

    if (step.action === "type") {
      const text = resolveValue(step.value, inputs);
      if (text === null) {
        return done({
          status: "failure",
          code: "input_invalid",
          message: `Missing input for type step: ${step.value.source === "input" ? step.value.name : "literal"}`,
          context: {
            stepIndex,
            action: "type",
            expected: summarizeTarget(step.target),
          },
        });
      }
      const result = await browser.type(polled.ref, text);
      if (!result.ok) {
        await appendRunEvent(runId, {
          event: "step_finished",
          stepIndex,
          result: "error",
        });
        return done({
          status: "failure",
          code: "step_failed",
          message: result.text ?? "Type failed",
          context: contextFrom(
            {
              stepIndex,
              action: "type",
              expected: summarizeTarget(step.target),
            },
            polled.observation,
          ),
        });
      }
      await appendRunEvent(runId, {
        event: "step_finished",
        stepIndex,
        result: "ok",
      });
      continue;
    }

    if (step.action === "select") {
      const value = resolveValue(step.value, inputs);
      if (value === null) {
        return done({
          status: "failure",
          code: "input_invalid",
          message: "Missing input for select step",
          context: {
            stepIndex,
            action: "select",
            expected: summarizeTarget(step.target),
          },
        });
      }
      const result = await browser.select(polled.ref, value);
      if (!result.ok) {
        await appendRunEvent(runId, {
          event: "step_finished",
          stepIndex,
          result: "error",
        });
        return done({
          status: "failure",
          code: "step_failed",
          message: result.text ?? "Select failed",
          context: contextFrom(
            {
              stepIndex,
              action: "select",
              expected: summarizeTarget(step.target),
            },
            polled.observation,
          ),
        });
      }
      await appendRunEvent(runId, {
        event: "step_finished",
        stepIndex,
        result: "ok",
      });
    }
  }

  const finalObservation = await browser.observe();
  const matched = matchCondition(finalObservation.snapshot, conditions);
  if (matched) {
    await appendRunEvent(runId, {
      event: "condition_detected",
      class: matched.class,
      code: matched.code,
    });
    return done(
      conditionResult(
        matched,
        contextFrom({ action: "extract_outputs" }, finalObservation),
      ),
    );
  }

  const outputs: Record<string, string> = {};

  for (const spec of parsed.outputs) {
    const extracted = extractOutput(finalObservation.snapshot, spec);
    if (!extracted.ok) {
      return done({
        status: "failure",
        code: extracted.code,
        message: `Output ${spec.name}: ${extracted.code}`,
        context: contextFrom(
          {
            action: "extract_outputs",
            expected: `output:${spec.name}`,
          },
          finalObservation,
        ),
      });
    }
    outputs[spec.name] = extracted.value;
  }

  return done({ status: "success", outputs });
}

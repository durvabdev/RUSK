import type { BrowserController } from "../browser/browser";
import type { ArtifactRunResult, ArtifactValue, WorkflowArtifact } from "./schema";
import { WorkflowArtifactSchema } from "./schema";
import { extractOutput } from "./extract-output";
import { resolveTarget } from "./resolve-target";

function resolveValue(
  value: ArtifactValue,
  inputs: Record<string, unknown>,
): string | null {
  if (value.source === "literal") return value.value;
  const raw = inputs[value.name];
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw;
}

export async function replayArtifact(
  artifact: WorkflowArtifact,
  inputs: Record<string, unknown>,
  browser: BrowserController,
): Promise<ArtifactRunResult> {
  const parsed = WorkflowArtifactSchema.parse(artifact);

  for (const [name, def] of Object.entries(parsed.inputs)) {
    if (!def.required) continue;
    const v = inputs[name];
    if (typeof v !== "string" || !v.trim()) {
      return {
        status: "failed",
        error: `Missing required input: ${name}`,
        code: "input_invalid",
      };
    }
  }

  await browser.navigate(parsed.startUrl);

  for (const step of parsed.steps) {
    if (step.action === "navigate") {
      await browser.navigate(step.url);
      continue;
    }

    if (step.action === "press_key") {
      await browser.pressKey(step.key);
      continue;
    }

    const observation = await browser.observe();

    if (step.action === "click") {
      const resolved = await resolveTarget(
        step.target,
        observation.snapshot,
        browser,
      );
      if (!resolved.ok) {
        return {
          status: "failed",
          error: `Could not resolve click target (${resolved.code})`,
          code: resolved.code,
        };
      }
      const result = await browser.click(resolved.ref);
      if (!result.ok) {
        return {
          status: "failed",
          error: result.text ?? "Click failed",
          code: "step_failed",
        };
      }
      continue;
    }

    if (step.action === "type") {
      const text = resolveValue(step.value, inputs);
      if (text === null) {
        return {
          status: "failed",
          error: `Missing input for type step: ${step.value.source === "input" ? step.value.name : "literal"}`,
          code: "input_invalid",
        };
      }
      const resolved = await resolveTarget(
        step.target,
        observation.snapshot,
        browser,
      );
      if (!resolved.ok) {
        return {
          status: "failed",
          error: `Could not resolve type target (${resolved.code})`,
          code: resolved.code,
        };
      }
      const result = await browser.type(resolved.ref, text);
      if (!result.ok) {
        return {
          status: "failed",
          error: result.text ?? "Type failed",
          code: "step_failed",
        };
      }
      continue;
    }

    if (step.action === "select") {
      const value = resolveValue(step.value, inputs);
      if (value === null) {
        return {
          status: "failed",
          error: "Missing input for select step",
          code: "input_invalid",
        };
      }
      const resolved = await resolveTarget(
        step.target,
        observation.snapshot,
        browser,
      );
      if (!resolved.ok) {
        return {
          status: "failed",
          error: `Could not resolve select target (${resolved.code})`,
          code: resolved.code,
        };
      }
      const result = await browser.select(resolved.ref, value);
      if (!result.ok) {
        return {
          status: "failed",
          error: result.text ?? "Select failed",
          code: "step_failed",
        };
      }
    }
  }

  const finalObservation = await browser.observe();
  const outputs: Record<string, string> = {};

  for (const spec of parsed.outputs) {
    const extracted = extractOutput(finalObservation.snapshot, spec);
    if (!extracted.ok) {
      return {
        status: "failed",
        error: `Output ${spec.name}: ${extracted.code}`,
        code: extracted.code,
      };
    }
    outputs[spec.name] = extracted.value;
  }

  return { status: "success", outputs };
}

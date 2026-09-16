import { z } from "zod";
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
        inputs,
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
        inputs,
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
        inputs,
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

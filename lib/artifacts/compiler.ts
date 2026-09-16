import {
  isCredentialField,
  type AuthFieldMeta,
} from "../agent/auth-form";
import type { AgentState } from "../agent/state";
import type {
  ArtifactOutput,
  ArtifactValue,
  ReplayStep,
  ReplayTarget,
  WorkflowArtifact,
} from "./schema";
import { extractDefinition, slugifyOutputName } from "./extract-output";

export class ArtifactCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactCompileError";
  }
}

export type CompileArtifactOptions = {
  name?: string;
  description?: string;
  /** Map typed literal text → public input name */
  inputNameByText?: Record<string, string>;
};

const REPLAYABLE_TOOLS = new Set([
  "click",
  "type",
  "select",
  "hover",
  "press_key",
  "navigate",
]);

function slugifyGoal(goal: string): string {
  const slug = goal
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
  return slug || "browser_workflow";
}

function replayTargetToAuthMeta(target: ReplayTarget): AuthFieldMeta {
  return {
    type: null,
    name: target.name ?? null,
    ariaLabel: target.name ?? null,
    placeholder: target.placeholder ?? null,
    autocomplete: null,
    role: target.role ?? null,
    text: target.text ?? null,
  };
}

function toolRef(args: unknown): string | null {
  if (typeof args !== "object" || args === null || !("ref" in args)) {
    return null;
  }
  const ref = (args as { ref: unknown }).ref;
  return typeof ref === "string" ? ref : null;
}

function toolText(args: unknown): string | null {
  if (typeof args !== "object" || args === null) return null;
  const o = args as Record<string, unknown>;
  if (typeof o.text === "string") return o.text;
  if (typeof o.value === "string") return o.value;
  return null;
}

export function compileArtifact(
  state: AgentState,
  options: CompileArtifactOptions = {},
): WorkflowArtifact {
  if (state.status !== "success") {
    throw new ArtifactCompileError("Run did not finish successfully");
  }

  if (!state.startUrl) {
    throw new ArtifactCompileError("Missing startUrl on agent state");
  }

  const steps: ReplayStep[] = [];
  const inputs: WorkflowArtifact["inputs"] = {};
  let inputCounter = 0;

  function nextInputName(literal: string): string {
    if (options.inputNameByText?.[literal]) {
      return options.inputNameByText[literal]!;
    }
    inputCounter += 1;
    return `input${inputCounter}`;
  }

  function registerInput(name: string, description?: string) {
    if (!inputs[name]) {
      inputs[name] = {
        type: "string",
        required: true,
        ...(description ? { description } : {}),
      };
    }
  }

  for (const entry of state.history) {
    if (!entry.toolResult.ok) continue;

    const { name, arguments: args } = entry.toolCall;
    if (!REPLAYABLE_TOOLS.has(name)) continue;

    if (name === "navigate") {
      const url =
        typeof args === "object" &&
        args !== null &&
        typeof (args as { url?: unknown }).url === "string"
          ? (args as { url: string }).url
          : null;
      if (url && url !== state.startUrl) {
        steps.push({ action: "navigate", url });
      }
      continue;
    }

    if (name === "press_key") {
      const key =
        typeof args === "object" &&
        args !== null &&
        typeof (args as { key?: unknown }).key === "string"
          ? (args as { key: string }).key
          : null;
      if (key) steps.push({ action: "press_key", key });
      continue;
    }

    if (!entry.replayTarget) {
      throw new ArtifactCompileError(
        `Successful ${name} step missing replayTarget metadata`,
      );
    }

    const target = entry.replayTarget;

    if (name === "click" || name === "hover") {
      steps.push({ action: "click", target });
      continue;
    }

    if (name === "type") {
      if (isCredentialField(replayTargetToAuthMeta(target))) {
        throw new ArtifactCompileError(
          "Credential typing steps cannot be compiled into artifacts",
        );
      }
      const literal = toolText(args);
      if (!literal) {
        throw new ArtifactCompileError("Type step missing text argument");
      }
      const inputName = nextInputName(literal);
      registerInput(
        inputName,
        target.name ?? target.placeholder ?? undefined,
      );
      const value: ArtifactValue = { source: "input", name: inputName };
      steps.push({ action: "type", target, value });
      continue;
    }

    if (name === "select") {
      const literal = toolText(args);
      if (!literal) {
        throw new ArtifactCompileError("Select step missing value argument");
      }
      const inputName = nextInputName(literal);
      registerInput(inputName);
      steps.push({
        action: "select",
        target,
        value: { source: "input", name: inputName },
      });
    }
  }

  if (steps.length === 0) {
    throw new ArtifactCompileError("No replayable steps in run history");
  }

  const outputs = deriveOutputs(state.observation?.snapshot ?? "");

  return {
    id: crypto.randomUUID(),
    version: 1,
    kind: "browser_workflow",
    name: options.name ?? slugifyGoal(state.goal),
    description: options.description ?? state.goal,
    sourceRunId: state.runId,
    startUrl: state.startUrl,
    requiresAuthenticatedSession: state.authRequired ?? false,
    inputs,
    steps,
    outputs,
    createdAt: new Date().toISOString(),
  };
}

function deriveOutputs(snapshot: string): ArtifactOutput[] {
  if (!snapshot.trim()) return [];

  const outputs: ArtifactOutput[] = [];
  const seen = new Set<string>();

  for (const line of snapshot.split("\n")) {
    const termMatch = line.match(
      /^\s*[\-]*\s*term(?:\s+\[ref=[^\]]+\])?\s*:\s*(.+)$/i,
    );
    if (!termMatch) continue;
    const label = termMatch[1]!.trim();
    const name = slugifyOutputName(label);
    if (!name || seen.has(name)) continue;

    const extracted = extractDefinition(snapshot, label);
    if (!extracted.ok) continue;

    seen.add(name);
    outputs.push({
      name,
      type: "string",
      extractor: { kind: "definition", label },
    });
  }

  return outputs;
}

import type { AgentStep, BrowserObservation, ObservedElement } from "./state";

export const PROGRESS_ACTIONS = new Set([
  "click",
  "type",
  "select",
  "navigate",
  "press_key",
  "go_back",
]);

export const NON_PROGRESS_ACTIONS = new Set([
  "inspect_element",
  "inspect_dom",
  "scroll",
  "hover",
]);

const REF_ATTR = /\[ref=[^\]]*]/g;
const WEEKDAY_LINE =
  /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const TIME_LINE =
  /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b|\b\d{1,2}\s*(?:am|pm)\b/i;

export function isProgressAction(step: AgentStep): boolean {
  return PROGRESS_ACTIONS.has(step.toolCall.name);
}

export function normalizeSnapshot(snapshot: string): string {
  return snapshot
    .split("\n")
    .map((line) => line.replace(REF_ATTR, "").trim())
    .filter((line) => {
      if (!line) return false;
      if (WEEKDAY_LINE.test(line)) return false;
      if (TIME_LINE.test(line) && line.length < 40) return false;
      return true;
    })
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function urlKey(url: string | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url.split("#")[0] ?? "";
  }
}

function elementSignal(el: ObservedElement): string {
  const role = el.role ?? "";
  const name = el.name ?? el.ariaLabel ?? el.text ?? "";
  const text = el.text ?? "";
  return `${role}|${name}|${text}|${el.disabled}|${el.visible}`;
}

export function createObservationSignature(
  observation: BrowserObservation,
): string {
  const elements = (observation.elements ?? [])
    .map(elementSignal)
    .join(";");
  return [
    urlKey(observation.url),
    observation.title ?? "",
    normalizeSnapshot(observation.snapshot),
    elements,
  ].join("\n");
}

function stripRefFromArgs(args: unknown): unknown {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return args;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (k === "ref") continue;
    out[k] = v;
  }
  return out;
}

export function actionFingerprint(step: AgentStep): string {
  const args = step.toolCall.arguments;
  const role =
    args && typeof args === "object" && !Array.isArray(args)
      ? String((args as Record<string, unknown>).role ?? "")
      : "";
  const name =
    args && typeof args === "object" && !Array.isArray(args)
      ? String(
          (args as Record<string, unknown>).name ??
            (args as Record<string, unknown>).elementName ??
            "",
        )
      : "";
  return JSON.stringify({
    tool: step.toolCall.name,
    role,
    name,
    args: stripRefFromArgs(args),
  });
}

export type ProgressEvaluation = {
  signatures: string[];
  noProgressCount: number;
  stuck: boolean;
  changed: boolean;
  repeatedStateCount: number;
  repeatedAction: boolean;
};

export function evaluateProgress(input: {
  observation: BrowserObservation;
  signatures: string[];
  noProgressCount: number;
  lastStep: AgentStep | undefined;
  previousStep: AgentStep | undefined;
}): ProgressEvaluation {
  const { observation, signatures, noProgressCount, lastStep, previousStep } =
    input;

  const current = createObservationSignature(observation);
  const previous = signatures.at(-1);
  const changed = previous === undefined || previous !== current;
  const nextSignatures = [...signatures, current].slice(-3);

  const repeatedAction =
    lastStep !== undefined &&
    previousStep !== undefined &&
    actionFingerprint(lastStep) === actionFingerprint(previousStep);

  if (!lastStep) {
    return {
      signatures: nextSignatures,
      noProgressCount: 0,
      stuck: false,
      changed,
      repeatedStateCount: nextSignatures.filter((sig) => sig === current).length,
      repeatedAction: false,
    };
  }

  if (!isProgressAction(lastStep)) {
    return {
      signatures: nextSignatures,
      noProgressCount,
      stuck: false,
      changed,
      repeatedStateCount: nextSignatures.filter((sig) => sig === current).length,
      repeatedAction,
    };
  }

  const nextNoProgressCount = changed ? 0 : noProgressCount + 1;
  const repeatedStateCount = nextSignatures.filter(
    (sig) => sig === current,
  ).length;
  const stuck = nextNoProgressCount >= 2 || repeatedStateCount >= 3;

  return {
    signatures: nextSignatures,
    noProgressCount: nextNoProgressCount,
    stuck,
    changed,
    repeatedStateCount,
    repeatedAction,
  };
}

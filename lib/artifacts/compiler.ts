import { isPasswordField, type AuthFieldMeta } from "../agent/auth-form";
import type { AgentState } from "../agent/state";
import type {
  ArtifactOutput,
  ArtifactValue,
  RecordedFormField,
  RecordedTarget,
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
  // hover intentionally omitted — do not silently emit as click
  "press_key",
  "navigate",
]);

// --- compile context (local) ---

type ParameterizedInput = {
  inputName: string;
  literal: string;
};

type CompileContext = {
  /** Most recent parameterized type/select before current step. */
  lastInput: ParameterizedInput | null;
  /** All parameterized literals so far (for instance-specific detection). */
  literals: string[];
  /** Path segments from startUrl for naming hints. */
  startUrlPathSegments: string[];
};

function createCompileContext(startUrl: string): CompileContext {
  let segments: string[] = [];
  try {
    segments = new URL(startUrl).pathname
      .split("/")
      .filter(Boolean)
      .map((s) => s.toLowerCase());
  } catch {
    segments = [];
  }
  return {
    lastInput: null,
    literals: [],
    startUrlPathSegments: segments,
  };
}

function registerParameterizedInput(
  ctx: CompileContext,
  inputName: string,
  literal: string,
): void {
  ctx.lastInput = { inputName, literal };
  if (!ctx.literals.includes(literal)) {
    ctx.literals.push(literal);
  }
}

// --- naming helpers (local) ---

const GENERIC_FIELD_NAMES = new Set([
  "q",
  "query",
  "search",
  "searchquery",
  "search_query",
  "term",
  "keywords",
]);

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

function singularize(segment: string): string {
  if (segment.endsWith("ies") && segment.length > 3) {
    return `${segment.slice(0, -3)}y`;
  }
  if (segment.endsWith("ses") || segment.endsWith("xes") || segment.endsWith("zes")) {
    return segment.slice(0, -2);
  }
  if (segment.endsWith("s") && !segment.endsWith("ss") && segment.length > 1) {
    return segment.slice(0, -1);
  }
  return segment;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Prefer path entity (e.g. /members → member_query) over input1. */
function inferInputName(
  literal: string,
  fieldHint: string | undefined,
  ctx: CompileContext,
  usedNames: Set<string>,
): string {
  const hint = fieldHint ? slugify(fieldHint) : "";
  if (hint && !GENERIC_FIELD_NAMES.has(hint.replace(/_/g, ""))) {
    const candidate = hint.endsWith("_query") ? hint : `${hint}_query`;
    if (!usedNames.has(candidate)) return candidate;
  }

  // Last meaningful path segment from start URL or recent navigations.
  for (const seg of [...ctx.startUrlPathSegments].reverse()) {
    if (seg === "login" || seg === "auth" || seg === "api") continue;
    const entity = singularize(seg);
    if (entity.length < 2) continue;
    const candidate = `${entity}_query`;
    if (!usedNames.has(candidate)) return candidate;
  }

  // Goal pattern: "look up X" already handled by strip; fall back.
  let n = 1;
  while (usedNames.has(`input${n}`)) n += 1;
  return `input${n}`;
}

/** Deterministic camelCase from a field label (form defaults). */
export function paramNameFromLabel(
  label: string | null | undefined,
  usedNames: Set<string>,
): string {
  const raw = (label ?? "").trim();
  if (!raw) {
    let n = 1;
    while (usedNames.has(`input${n}`)) n += 1;
    return `input${n}`;
  }

  const words = raw
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    let n = 1;
    while (usedNames.has(`input${n}`)) n += 1;
    return `input${n}`;
  }

  let base = words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 48);

  if (!base || /^\d/.test(base)) {
    base = `input${base || "1"}`;
  }

  if (!usedNames.has(base)) return base;
  let n = 2;
  while (usedNames.has(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}

/** Semantic identity for deduping form fields vs explicit type/select (no refs). */
export function targetIdentity(
  target: Pick<
    RecordedTarget,
    "testId" | "role" | "name" | "text" | "placeholder"
  > & { label?: string | null },
): string | null {
  if (target.testId) return `testid:${normalize(target.testId)}`;
  if (target.role && target.name) {
    return `role:${normalize(target.role)}|name:${normalize(target.name)}`;
  }
  if (target.name) return `name:${normalize(target.name)}`;
  if (target.label) return `label:${normalize(target.label)}`;
  if (target.text) return `text:${normalize(target.text)}`;
  if (target.placeholder) return `ph:${normalize(target.placeholder)}`;
  return null;
}

function generalizeArtifactName(
  goal: string,
  literals: string[],
  ctx: CompileContext,
): { name: string; description: string } {
  let text = goal.trim();
  for (const lit of literals) {
    if (!lit.trim()) continue;
    const re = new RegExp(escapeRegExp(lit), "gi");
    text = text.replace(re, "").replace(/\s+/g, " ").trim();
  }

  // Replace trailing possessives / "of" leftovers.
  text = text.replace(/\b(of|for|the)\s*$/i, "").trim();
  if (!text) text = "browser workflow";

  // If we stripped a person/entity and have a path entity, prefer "look up member".
  const entitySeg = [...ctx.startUrlPathSegments]
    .reverse()
    .map(singularize)
    .find((s) => s.length > 1 && s !== "login" && s !== "auth");

  if (entitySeg && literals.length > 0) {
    const lower = text.toLowerCase();
    if (
      /^(look\s*up|find|search|get|open|view)\b/i.test(goal) &&
      !lower.includes(entitySeg)
    ) {
      const verb = goal.match(/^(look\s*up|find|search|get|open|view)/i)?.[1] ?? "look up";
      text = `${verb} ${entitySeg}`;
    }
  }

  const name = slugify(text) || "browser_workflow";
  const description =
    text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

  return { name, description };
}

// --- target generalization (local) ---

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_ID_RE = /^[0-9a-f]{8,}$/i;
const NUMERIC_ID_RE = /^\d{3,}$/;

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Last path segment looks like an instance id. */
function hrefHasInstanceTail(href: string): boolean {
  try {
    const path = href.includes("://")
      ? new URL(href).pathname
      : href.split("?")[0] ?? href;
    const segments = path.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";
    if (!last) return false;
    if (NUMERIC_ID_RE.test(last)) return true;
    if (UUID_RE.test(last)) return true;
    if (HEX_ID_RE.test(last) && last.length >= 8) return true;
    return false;
  } catch {
    return false;
  }
}

function containsLiteral(haystack: string | undefined, literals: string[]): boolean {
  if (!haystack) return false;
  const h = normalize(haystack);
  return literals.some((lit) => lit.trim() && h.includes(normalize(lit)));
}

function isInstanceSpecific(
  recorded: RecordedTarget,
  ctx: CompileContext,
): boolean {
  if (recorded.href && hrefHasInstanceTail(recorded.href)) return true;
  if (containsLiteral(recorded.href, ctx.literals)) return true;
  if (containsLiteral(recorded.text, ctx.literals)) return true;
  if (containsLiteral(recorded.name, ctx.literals)) return true;
  const label = recorded.name ?? recorded.text;
  if (
    label &&
    ctx.literals.some((lit) => normalize(lit) === normalize(label))
  ) {
    return true;
  }
  return false;
}

/**
 * Turn recorded facts into a replay target.
 * Stable controls stay simple; instance-specific clicks get within-scope.
 */
function generalizeTarget(
  recorded: RecordedTarget,
  ctx: CompileContext,
  options: { isClick: boolean } = { isClick: true },
): ReplayTarget {
  const target: ReplayTarget = {};

  if (recorded.testId) target.testId = recorded.testId;

  const instanceSpecific = isInstanceSpecific(recorded, ctx);
  const needsScope =
    options.isClick && instanceSpecific && ctx.lastInput !== null;

  // Stable role/name/text (skip text/name that equals a typed literal when scoping).
  if (recorded.role) target.role = recorded.role;

  const label = recorded.name ?? recorded.text;
  if (label) {
    const isLiteralLabel = ctx.literals.some(
      (lit) => normalize(lit) === normalize(label),
    );
    if (!isLiteralLabel || !needsScope) {
      if (recorded.name) target.name = recorded.name;
      else if (recorded.text) target.text = recorded.text;
    } else if (recorded.role) {
      // Keep role; name was the search literal itself — drop it.
    }
  }

  if (recorded.placeholder) target.placeholder = recorded.placeholder;

  if (needsScope && ctx.lastInput) {
    target.within = {
      kind: "matching_container",
      value: { source: "input", name: ctx.lastInput.inputName },
    };
  }

  const hasSignal =
    target.testId ||
    target.role ||
    target.name ||
    target.text ||
    target.placeholder ||
    target.within;

  if (!hasSignal) {
    // Fall back to whatever stable name we have even if weak.
    if (recorded.name) target.name = recorded.name;
    else if (recorded.text) target.text = recorded.text;
  }

  return target;
}

/** Type/select targets: prefer testId; never use dynamic href. */
function generalizeInputTarget(recorded: RecordedTarget): ReplayTarget {
  const target: ReplayTarget = {};
  if (recorded.testId) target.testId = recorded.testId;
  if (recorded.role) target.role = recorded.role;
  // With testId, skip HTML name attr (often ≠ a11y name). Without it, keep name.
  if (!recorded.testId) {
    if (recorded.name) target.name = recorded.name;
    else if (recorded.text) target.text = recorded.text;
  }
  if (recorded.placeholder) target.placeholder = recorded.placeholder;
  return target;
}

// --- public compile API ---

function recordedToAuthMeta(target: RecordedTarget): AuthFieldMeta {
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

function toolText(args: unknown): string | null {
  if (typeof args !== "object" || args === null) return null;
  const o = args as Record<string, unknown>;
  if (typeof o.text === "string") return o.text;
  if (typeof o.value === "string") return o.value;
  return null;
}

const ACK_HINT =
  /\b(ordered|debited|success|successful|confirmed|complete|completed|acknowledg|submitted|saved|created|updated)\b/i;

/** Strip amounts / account-like tokens so checkpoints are not member-specific. */
export function stabilizeAckText(raw: string): string {
  const cleaned = raw
    .replace(/\$[\d,.]+/g, "")
    .replace(/\b[A-Z]{2}-\d+(?:-\d+)*\b/g, "")
    .replace(/\bTX-[A-Z0-9-]+\b/gi, "")
    .replace(/\b\d{4,}\b/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*[.,;:]\s*$/g, "")
    .trim();
  const first = cleaned.split(/[.!?]/)[0]?.trim() ?? cleaned;
  return first.replace(/\s+/g, " ").trim();
}

function flashFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    for (const key of ["flash", "message", "status", "notice", "toast"]) {
      const v = u.searchParams.get(key);
      if (v && v.trim()) return v.trim();
    }
  } catch {
    /* ignore */
  }
  return null;
}

function lineLooksLikeDefinition(line: string): boolean {
  return /^\s*[\-]*\s*(term|definition)(?:\s|\[|:)/i.test(line);
}

function extractAlertishFromSnapshot(snapshot: string): string | null {
  for (const line of snapshot.split("\n")) {
    const t = line.trim();
    if (!t || lineLooksLikeDefinition(t)) continue;
    if (
      /\b(alert|status|banner|flash|toast|notice)\b/i.test(t) ||
      /role[=:]?\s*["']?(alert|status)/i.test(t)
    ) {
      const quoted = t.match(/"([^"]{3,})"/);
      if (quoted?.[1] && ACK_HINT.test(quoted[1])) {
        return quoted[1];
      }
      const afterColon = t.split(":").slice(1).join(":").trim();
      if (afterColon && ACK_HINT.test(afterColon)) return afterColon;
    }
  }
  for (const line of snapshot.split("\n")) {
    const t = line.trim();
    if (!t || lineLooksLikeDefinition(t)) continue;
    const quoted = t.match(/"([^"]{3,})"/);
    const candidate = quoted?.[1] ?? t.replace(/^[\-\*•]\s*/, "");
    if (ACK_HINT.test(candidate) && candidate.length < 200) {
      return candidate;
    }
  }
  return null;
}

/** Stable detail-page labels (look-up success) — not instance values. */
function extractDetailLabelFromSnapshot(snapshot: string): string | null {
  const labels: string[] = [];
  for (const line of snapshot.split("\n")) {
    const termMatch = line.match(
      /^\s*[\-]*\s*term(?:\s+\[ref=[^\]]+\])?\s*:\s*(.+)$/i,
    );
    if (!termMatch) continue;
    const label = termMatch[1]!.trim();
    if (label) labels.push(label);
  }
  if (labels.length === 0) return null;
  const preferred = labels.find((l) => /^member\s*id$/i.test(l));
  return preferred ?? labels[0]!;
}

export function deriveCheckpoint(
  snapshot: string,
  url?: string,
): { kind: "text_present"; text: string } {
  // Same class of evidence the actor must cite to finish: visible page proof.
  // Prefer transactional ack (flash/alert); else detail-page labels for look-ups.
  const fromFlash = flashFromUrl(url);
  const raw =
    fromFlash ??
    extractAlertishFromSnapshot(snapshot) ??
    extractDetailLabelFromSnapshot(snapshot);
  if (!raw) {
    throw new ArtifactCompileError(
      "Cannot derive success checkpoint from final observation",
    );
  }
  const text = fromFlash || ACK_HINT.test(raw)
    ? stabilizeAckText(raw)
    : raw.trim();
  if (!text || text.length < 3) {
    throw new ArtifactCompileError(
      "Cannot derive a stable success checkpoint text",
    );
  }
  return { kind: "text_present", text };
}

function pendingAlreadyInSteps(
  steps: ReplayStep[],
  recorded: RecordedTarget,
): boolean {
  const signal =
    recorded.testId ||
    recorded.name ||
    recorded.text ||
    recorded.role;
  if (!signal) return false;
  for (const step of steps) {
    if (step.action !== "click" && step.action !== "type" && step.action !== "select") {
      continue;
    }
    const t = step.target;
    if (recorded.testId && t.testId === recorded.testId) return true;
    if (recorded.name && (t.name === recorded.name || t.text === recorded.name)) {
      return true;
    }
    if (recorded.text && (t.text === recorded.text || t.name === recorded.text)) {
      return true;
    }
  }
  return false;
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
  const usedNames = new Set<string>();
  const ctx = createCompileContext(state.startUrl);

  // Enrich path segments from navigate steps and recorded hrefs.
  for (const entry of state.history) {
    const urls: string[] = [];
    if (entry.toolCall.name === "navigate" && entry.toolResult.ok) {
      const args = entry.toolCall.arguments;
      if (
        typeof args === "object" &&
        args !== null &&
        typeof (args as { url?: unknown }).url === "string"
      ) {
        urls.push((args as { url: string }).url);
      }
    }
    if (entry.recordedTarget?.href) {
      urls.push(entry.recordedTarget.href);
    }
    for (const url of urls) {
      try {
        const path = url.includes("://")
          ? new URL(url).pathname
          : url.split("?")[0] ?? url;
        for (const seg of path.split("/").filter(Boolean)) {
          const lower = seg.toLowerCase();
          // Skip instance-looking segments for naming.
          if (/^\d+$/.test(lower) || lower.length > 24) continue;
          if (!ctx.startUrlPathSegments.includes(lower)) {
            ctx.startUrlPathSegments.push(lower);
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  function nextInputName(literal: string, fieldHint?: string): string {
    if (options.inputNameByText?.[literal]) {
      return options.inputNameByText[literal]!;
    }
    const name = inferInputName(literal, fieldHint, ctx, usedNames);
    usedNames.add(name);
    return name;
  }

  function registerInput(
    name: string,
    description?: string,
    opts?: {
      required?: boolean;
      type?: "string" | "boolean";
      default?: string | boolean;
    },
  ) {
    if (!inputs[name]) {
      inputs[name] = {
        type: opts?.type ?? "string",
        // Workflow inputs are always optional; empty → skip step / use default / fail later.
        required: false,
        ...(description ? { description } : {}),
        ...(opts?.default !== undefined ? { default: opts.default } : {}),
      };
    }
  }

  /** Target identity → already-parameterized input name. */
  const parameterizedByTarget = new Map<string, string>();

  function rememberTarget(recorded: RecordedTarget, inputName: string) {
    const id = targetIdentity(recorded);
    if (id) parameterizedByTarget.set(id, inputName);
  }

  function emitFormDefaultSteps(fields: RecordedFormField[]) {
    for (const field of fields) {
      const id = targetIdentity({
        ...field.target,
        label: field.label,
      });
      if (id && parameterizedByTarget.has(id)) continue;

      const hint =
        field.label ?? field.name ?? field.target.name ?? field.target.placeholder;
      const inputName = paramNameFromLabel(hint, usedNames);
      usedNames.add(inputName);

      const isBool =
        field.controlType === "checkbox" ||
        (field.controlType === "radio" && typeof field.value === "boolean");

      // Product defaults (select/check) keep default for replay-when-omitted.
      // Text/textarea: optional, no baked value (PII) — replay skips if caller leaves empty.
      const keepDefault =
        field.controlType === "select" ||
        field.controlType === "checkbox" ||
        field.controlType === "radio";

      registerInput(inputName, hint ?? undefined, {
        required: false,
        type: isBool || typeof field.value === "boolean" ? "boolean" : "string",
        ...(keepDefault ? { default: field.value } : {}),
      });

      if (id) parameterizedByTarget.set(id, inputName);

      const value: ArtifactValue = { source: "input", name: inputName };
      const target = generalizeInputTarget(field.target);

      if (field.controlType === "select") {
        steps.push({ action: "select", target, value });
      } else if (
        field.controlType === "checkbox" ||
        field.controlType === "radio"
      ) {
        steps.push({ action: "set_checked", target, value });
      } else {
        steps.push({ action: "type", target, value });
      }
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

    if (!entry.recordedTarget) {
      throw new ArtifactCompileError(
        `Successful ${name} step missing recordedTarget metadata`,
      );
    }

    const recorded = entry.recordedTarget;

    if (name === "click") {
      if (entry.recordedFormFields?.length) {
        emitFormDefaultSteps(entry.recordedFormFields);
      }
      const target = generalizeTarget(recorded, ctx, { isClick: true });
      steps.push({ action: "click", target });
      continue;
    }

    if (name === "type") {
      // Password/OTP only — email/username are often task data (profile edits).
      if (isPasswordField(recordedToAuthMeta(recorded))) {
        throw new ArtifactCompileError(
          "Credential typing steps cannot be compiled into artifacts",
        );
      }
      const literal = toolText(args);
      if (!literal) {
        throw new ArtifactCompileError("Type step missing text argument");
      }
      const fieldHint =
        recorded.name ?? recorded.placeholder ?? undefined;
      const inputName = nextInputName(literal, fieldHint);
      registerInput(inputName, fieldHint);
      registerParameterizedInput(ctx, inputName, literal);
      rememberTarget(recorded, inputName);
      const value: ArtifactValue = { source: "input", name: inputName };
      const target = generalizeInputTarget(recorded);
      steps.push({ action: "type", target, value });
      // Sibling form controls (untouched defaults) → optional inputs.
      if (entry.recordedFormFields?.length) {
        emitFormDefaultSteps(entry.recordedFormFields);
      }
      continue;
    }

    if (name === "select") {
      const literal = toolText(args);
      if (!literal) {
        throw new ArtifactCompileError("Select step missing value argument");
      }
      const inputName = nextInputName(literal, recorded.name);
      registerInput(inputName);
      registerParameterizedInput(ctx, inputName, literal);
      rememberTarget(recorded, inputName);
      steps.push({
        action: "select",
        target: generalizeInputTarget(recorded),
        value: { source: "input", name: inputName },
      });
      if (entry.recordedFormFields?.length) {
        emitFormDefaultSteps(entry.recordedFormFields);
      }
    }
  }

  if (steps.length === 0) {
    throw new ArtifactCompileError("No replayable steps in run history");
  }

  // HITL: policy-blocked commit may never have executed — still emit as final step.
  const pending = state.pendingCommit;
  if (pending && ["click", "type", "select"].includes(pending.toolCall.name)) {
    const recorded = pending.recordedTarget;
    if (!pendingAlreadyInSteps(steps, recorded)) {
      const name = pending.toolCall.name;
      if (name === "click") {
        if (pending.recordedFormFields?.length) {
          emitFormDefaultSteps(pending.recordedFormFields);
        }
        steps.push({
          action: "click",
          target: generalizeTarget(recorded, ctx, { isClick: true }),
        });
      } else if (name === "type") {
        if (isPasswordField(recordedToAuthMeta(recorded))) {
          throw new ArtifactCompileError(
            "Credential typing steps cannot be compiled into artifacts",
          );
        }
        const literal = toolText(pending.toolCall.arguments);
        if (!literal) {
          throw new ArtifactCompileError("Pending type step missing text");
        }
        const fieldHint =
          recorded.name ?? recorded.placeholder ?? undefined;
        const inputName = nextInputName(literal, fieldHint);
        registerInput(inputName, fieldHint);
        registerParameterizedInput(ctx, inputName, literal);
        rememberTarget(recorded, inputName);
        steps.push({
          action: "type",
          target: generalizeInputTarget(recorded),
          value: { source: "input", name: inputName },
        });
      } else if (name === "select") {
        const literal = toolText(pending.toolCall.arguments);
        if (!literal) {
          throw new ArtifactCompileError("Pending select step missing value");
        }
        const inputName = nextInputName(literal, recorded.name);
        registerInput(inputName);
        registerParameterizedInput(ctx, inputName, literal);
        rememberTarget(recorded, inputName);
        steps.push({
          action: "select",
          target: generalizeInputTarget(recorded),
          value: { source: "input", name: inputName },
        });
      }
    }
  }

  const { name: inferredName, description: inferredDesc } =
    generalizeArtifactName(state.goal, ctx.literals, ctx);

  const outputs = deriveOutputs(state.observation?.snapshot ?? "");
  const checkpoint = deriveCheckpoint(
    state.observation?.snapshot ?? "",
    state.observation?.url,
  );

  return {
    id: crypto.randomUUID(),
    version: 1,
    kind: "browser_workflow",
    name: options.name ?? inferredName,
    description: options.description ?? inferredDesc,
    sourceRunId: state.runId,
    startUrl: state.startUrl,
    requiresAuthenticatedSession: state.authRequired ?? false,
    inputs,
    steps,
    outputs,
    conditions: [],
    checkpoint,
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

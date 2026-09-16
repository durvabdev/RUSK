import {
  getPolicyConfig,
  originOf,
  type ActionRisk,
  type PolicyAction,
  type PolicyConfig,
} from "./config";

export type PolicyElementMeta = {
  risk?: ActionRisk | null;
  actionCategory?: string | null;
  role?: string | null;
  name?: string | null;
  href?: string | null;
  type?: string | null;
  text?: string | null;
};

export type PolicyInput = {
  action: string;
  /** Page URL before the action (for click/type/select/press_key). */
  currentUrl?: string | null;
  /** Destination URL when action is navigate. */
  navigateUrl?: string | null;
  element?: PolicyElementMeta | null;
};

export type PolicyDecision =
  | { ok: true; risk: ActionRisk }
  | {
      ok: false;
      code: "origin_blocked" | "action_blocked" | "policy_requires_human";
      message: string;
      risk?: ActionRisk;
    };

/** Brittle fallback when data-risk is absent — may miss app-specific commits. */
const RISKY_FALLBACK =
  /\b(transfer|payment|wire|payout|withdraw|send[-_ ]?money|delete[-_ ]?account|close[-_ ]?account)\b/i;

function parseRisk(raw: string | null | undefined): ActionRisk | null {
  if (raw === "safe" || raw === "reversible_mutation" || raw === "risky") {
    return raw;
  }
  return null;
}

export function classifyRisk(
  action: string,
  element?: PolicyElementMeta | null,
  urlHint?: string | null,
): ActionRisk {
  const attributed = parseRisk(element?.risk ?? null);
  if (attributed) return attributed;

  // Keyword fallback on URL + element metadata only when data-risk missing.
  const haystack = [
    urlHint ?? "",
    element?.href ?? "",
    element?.name ?? "",
    element?.text ?? "",
    element?.actionCategory ?? "",
  ].join(" ");
  if (RISKY_FALLBACK.test(haystack)) return "risky";

  if (action === "navigate" || action === "press_key") return "safe";
  if (
    action === "click" ||
    action === "type" ||
    action === "select"
  ) {
    return "reversible_mutation";
  }
  return "reversible_mutation";
}

export function evaluateActionPolicy(
  input: PolicyInput,
  config: PolicyConfig = getPolicyConfig(),
): PolicyDecision {
  const action = input.action;
  if (!config.allowedActions.includes(action as PolicyAction)) {
    return {
      ok: false,
      code: "action_blocked",
      message: `Action not allowed by policy: ${action}`,
    };
  }

  const urlForOrigin =
    action === "navigate" ? input.navigateUrl : input.currentUrl;
  const origin = originOf(urlForOrigin ?? null);
  if (!origin || !config.allowedOrigins.includes(origin)) {
    return {
      ok: false,
      code: "origin_blocked",
      message: `Origin not allowed by policy: ${origin ?? urlForOrigin ?? "(unknown)"}`,
    };
  }

  const risk = classifyRisk(action, input.element, urlForOrigin);
  const rule = config.riskRules[risk];
  if (rule === "require_human") {
    return {
      ok: false,
      code: "policy_requires_human",
      message: `Risky action requires human approval (${risk})`,
      risk,
    };
  }

  return { ok: true, risk };
}

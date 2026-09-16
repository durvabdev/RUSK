export type ActionRisk = "safe" | "reversible_mutation" | "risky";

export type PolicyAction =
  | "navigate"
  | "click"
  | "type"
  | "select"
  | "press_key"
  | "inspect_element"
  | "inspect_dom"
  | "hover"
  | "go_back"
  | "scroll";

export type PolicyConfig = {
  allowedOrigins: string[];
  allowedActions: PolicyAction[];
  riskRules: {
    safe: "allow";
    reversible_mutation: "allow";
    risky: "require_human";
  };
};

const DEFAULT_ORIGIN = "https://dough-credit-union.vercel.app";

const DEFAULT_ACTIONS: PolicyAction[] = [
  "navigate",
  "click",
  "type",
  "select",
  "press_key",
  "inspect_element",
  "inspect_dom",
  "hover",
  "go_back",
  "scroll",
];

/** Explicit allowlist only — never derived from user startUrl. */
export function getPolicyConfig(): PolicyConfig {
  const fromEnv = process.env.RUSK_ALLOWED_ORIGINS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    allowedOrigins: fromEnv && fromEnv.length > 0 ? fromEnv : [DEFAULT_ORIGIN],
    allowedActions: [...DEFAULT_ACTIONS],
    riskRules: {
      safe: "allow",
      reversible_mutation: "allow",
      risky: "require_human",
    },
  };
}

export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Resolve absolute or relative URLs against an optional base (current page). */
export function resolvePolicyUrl(
  url: string | null | undefined,
  base?: string | null,
): string | null {
  if (!url) return null;
  try {
    const u = base ? new URL(url, base) : new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

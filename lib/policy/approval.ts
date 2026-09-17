export type ApprovalRule = {
  name: string;
  reason: string;
};

/** Explicit high-impact button clicks that require HUMAN approval in discovery. */
export const APPROVAL_REQUIRED: ApprovalRule[] = [
  {
    name: "Close account",
    reason: "Account closure is irreversible",
  },
];

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * Match click on a button by accessible name.
 * Native <button> often has no role attribute — accept tag === "button" too.
 */
export function matchApprovalRule(
  tool: string,
  target: {
    role?: string | null;
    name?: string | null;
    text?: string | null;
    tag?: string | null;
  },
): ApprovalRule | null {
  if (tool !== "click") return null;
  const isButton =
    norm(target.role) === "button" || norm(target.tag) === "button";
  if (!isButton) return null;

  const targetName = norm(target.name) || norm(target.text);
  if (!targetName) return null;

  for (const rule of APPROVAL_REQUIRED) {
    if (norm(rule.name) === targetName) return rule;
  }
  return null;
}

export function formatApprovalRequest(
  targetName: string,
  reason: string,
): { type: "approval"; message: string } {
  return {
    type: "approval",
    message: `Approval required\nAction: Click "${targetName}"\nReason: ${reason}\n\nPerform the action in the live browser, then resume.`,
  };
}

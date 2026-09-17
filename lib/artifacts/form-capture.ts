import type { ElementInspection } from "../browser/browser";

const COMMIT_NAME =
  /\b(submit|confirm|save|create|issue|open|order|apply|send)\b/i;

/** Whether to dump sibling form fields before this action. */
export function shouldCaptureFormFields(
  toolName: string,
  inspection: ElementInspection | null | undefined,
): boolean {
  // Typing/selecting inside a form — capture siblings so defaults become inputs
  // even if the agent never clicks Save/Submit during discovery.
  if (toolName === "type" || toolName === "select") {
    return true;
  }

  if (toolName !== "click" || !inspection) return false;

  const tag = (inspection.tag ?? "").toLowerCase();
  const type = (inspection.type ?? "").toLowerCase();
  const role = (inspection.role ?? "").toLowerCase();
  const isButtonLike =
    tag === "button" ||
    role === "button" ||
    type === "submit" ||
    type === "button" ||
    (tag === "input" && (type === "submit" || type === "button"));

  if (!isButtonLike) return false;

  if (
    inspection.risk === "risky" ||
    inspection.risk === "reversible_mutation"
  ) {
    return true;
  }

  const haystack = [inspection.name, inspection.text, inspection.ariaLabel]
    .filter(Boolean)
    .join(" ");
  if (COMMIT_NAME.test(haystack)) return true;

  // Form association confirmed by captureFormFields returning fields.
  return true;
}

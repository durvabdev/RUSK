import type { ElementInspection } from "../browser/browser";
import type { ReplayTarget } from "./schema";

/** Map inspectElement metadata to a compact replay target (no MCP ref). */
export function replayTargetFromInspection(
  element: ElementInspection,
): ReplayTarget | null {
  const target: ReplayTarget = {};

  if (element.testId) target.testId = element.testId;
  if (element.role) target.role = element.role;
  if (element.name) target.name = element.name;
  else if (element.ariaLabel) target.name = element.ariaLabel;
  else if (element.text) target.text = element.text;
  if (element.placeholder) target.placeholder = element.placeholder;
  if (element.href) target.href = element.href;

  const hasSignal =
    target.testId ||
    target.role ||
    target.name ||
    target.text ||
    target.placeholder ||
    target.href ||
    target.id;

  return hasSignal ? target : null;
}

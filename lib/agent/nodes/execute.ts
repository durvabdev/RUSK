import type {
  BrowserController,
  ElementInspection,
} from "../../browser/browser";
import type { ToolRegistry } from "../../tools/registry";
import { parseSnapshotCandidates } from "../../artifacts/snapshot-parser";
import type { RecordedTarget } from "../../artifacts/schema";
import type {
  AgentState,
  AgentStateUpdate,
  AgentStep,
} from "../state";

const CAPTURE_TOOLS = new Set(["click", "type", "select", "hover"]);

function toolRef(args: unknown): string | null {
  if (typeof args !== "object" || args === null || !("ref" in args)) {
    return null;
  }
  const ref = (args as { ref: unknown }).ref;
  return typeof ref === "string" && ref.length > 0 ? ref : null;
}

/** Map inspectElement metadata to recorded facts (no replay semantics). */
function recordedTargetFromInspection(
  element: ElementInspection,
  ref?: string,
): RecordedTarget | null {
  const target: RecordedTarget = {};

  if (ref) target.ref = ref;
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
    target.id ||
    target.ref;

  return hasSignal ? target : null;
}

function recordedTargetFromSnapshot(
  snapshot: string | undefined,
  ref: string,
): RecordedTarget | undefined {
  if (!snapshot) return undefined;
  const candidate = parseSnapshotCandidates(snapshot).find((c) => c.ref === ref);
  if (!candidate) return undefined;
  const target: RecordedTarget = { ref };
  if (candidate.role) target.role = candidate.role;
  if (candidate.name) target.name = candidate.name;
  if (candidate.href) target.href = candidate.href;
  return Object.keys(target).length > 1 ? target : { ref };
}

export function createExecuteNode(
  registry: ToolRegistry,
  browser: BrowserController,
) {
  return async function executeNode(
    state: AgentState,
  ): Promise<AgentStateUpdate> {
    const decision = state.decision;

    if (!decision) {
      throw new Error("execute node called without a decision");
    }

    if (decision.type !== "tool" || !decision.call) {
      throw new Error(
        `execute node received non-tool decision: ${decision.type}`,
      );
    }

    const toolCall = {
      name: decision.call.name,
      arguments: decision.call.arguments,
    };

    // Capture facts while the MCP ref is still valid (before the action mutates the page).
    let recordedTarget: AgentStep["recordedTarget"];
    const ref = toolRef(toolCall.arguments);
    if (CAPTURE_TOOLS.has(toolCall.name) && ref) {
      try {
        const inspection = await browser.inspectElement(ref);
        recordedTarget =
          recordedTargetFromInspection(inspection, ref) ?? undefined;
      } catch {
        /* fall through to snapshot */
      }
      const fromSnapshot = recordedTargetFromSnapshot(
        state.observation?.snapshot,
        ref,
      );
      if (!recordedTarget) {
        recordedTarget = fromSnapshot;
      } else if (fromSnapshot) {
        // Inspection often omits a11y role; snapshot still has link/button/etc.
        if (!recordedTarget.role && fromSnapshot.role) {
          recordedTarget = { ...recordedTarget, role: fromSnapshot.role };
        }
        // Prefer a11y name from snapshot over HTML name= from inspect.
        if (fromSnapshot.name) {
          recordedTarget = { ...recordedTarget, name: fromSnapshot.name };
        }
      }
    }

    const toolResult = await registry.invoke(toolCall);

    const step: AgentStep = {
      step: state.stepCount + 1,
      toolCall,
      toolResult,
      ...(toolResult.ok && recordedTarget ? { recordedTarget } : {}),
      timestamp: Date.now(),
    };

    return {
      history: step,
      stepCount: 1,
    };
  };
}

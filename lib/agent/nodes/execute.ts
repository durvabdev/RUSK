import type { BrowserController } from "../../browser/browser";
import type { ToolRegistry } from "../../tools/registry";
import { replayTargetFromInspection } from "../../artifacts/replay-target";
import { parseSnapshotCandidates } from "../../artifacts/snapshot-parser";
import type { ReplayTarget } from "../../artifacts/schema";
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

function replayTargetFromSnapshot(
  snapshot: string | undefined,
  ref: string,
): ReplayTarget | undefined {
  if (!snapshot) return undefined;
  const candidate = parseSnapshotCandidates(snapshot).find((c) => c.ref === ref);
  if (!candidate) return undefined;
  const target: ReplayTarget = {};
  if (candidate.role) target.role = candidate.role;
  if (candidate.name) target.name = candidate.name;
  if (candidate.href) target.href = candidate.href;
  return Object.keys(target).length > 0 ? target : undefined;
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

    // Capture while the MCP ref is still valid (before the action mutates the page).
    let replayTarget: AgentStep["replayTarget"];
    const ref = toolRef(toolCall.arguments);
    if (CAPTURE_TOOLS.has(toolCall.name) && ref) {
      try {
        const inspection = await browser.inspectElement(ref);
        replayTarget = replayTargetFromInspection(inspection) ?? undefined;
      } catch {
        /* fall through to snapshot */
      }
      if (!replayTarget) {
        replayTarget = replayTargetFromSnapshot(
          state.observation?.snapshot,
          ref,
        );
      }
    }

    const toolResult = await registry.invoke(toolCall);

    const step: AgentStep = {
      step: state.stepCount + 1,
      toolCall,
      toolResult,
      ...(toolResult.ok && replayTarget ? { replayTarget } : {}),
      timestamp: Date.now(),
    };

    return {
      history: step,
      stepCount: 1,
    };
  };
}

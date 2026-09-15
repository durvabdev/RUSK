import type { ToolRegistry } from "../../tools/registry";
import type {
  AgentState,
  AgentStateUpdate,
  AgentStep,
} from "../state";

export function createExecuteNode(registry: ToolRegistry) {
  return async function executeNode(
    state: AgentState,
  ): Promise<AgentStateUpdate> {
    const decision = state.decision;

    if (!decision) {
      throw new Error("execute node called without a decision");
    }

    if (decision.type !== "tool") {
      throw new Error(
        `execute node received non-tool decision: ${decision.type}`,
      );
    }

    const toolResult = await registry.invoke(decision.call);

    const step: AgentStep = {
      step: state.stepCount + 1,
      toolCall: decision.call,
      toolResult,
      timestamp: Date.now(),
    };

    return {
      history: step,
      stepCount: 1,
    };
  };
}
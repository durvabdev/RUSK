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

    if (decision.type !== "tool" || !decision.call) {
      throw new Error(
        `execute node received non-tool decision: ${decision.type}`,
      );
    }

    const toolCall = {
      name: decision.call.name,
      arguments: decision.call.arguments,
    };
    const toolResult = await registry.invoke(toolCall);

    console.log(
      "[tool result]",
      JSON.stringify(toolResult, null, 2),
    );

    const step: AgentStep = {
      step: state.stepCount + 1,
      toolCall,
      toolResult,
      timestamp: Date.now(),
    };

    return {
      history: step,
      stepCount: 1,
    };
  };
}

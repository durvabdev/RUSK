import { evaluateProgress } from "../progress";
import type { AgentState, AgentStateUpdate } from "../state";

const STUCK_MESSAGE =
  "The agent attempted multiple browser actions without any meaningful page-state change. Human intervention is required before continuing.";

export function createCheckProgressNode() {
  return function checkProgressNode(state: AgentState): AgentStateUpdate {
    if (!state.observation) {
      throw new Error("check_progress requires an observation");
    }

    const lastStep = state.history.at(-1);
    const previousStep = state.history.at(-2);

    const result = evaluateProgress({
      observation: state.observation,
      signatures: state.observationSignatures ?? [],
      noProgressCount: state.noProgressCount ?? 0,
      lastStep,
      previousStep,
    });

    console.log("[progress]", {
      changed: result.changed,
      noProgressCount: result.noProgressCount,
      repeatedStateCount: result.repeatedStateCount,
      repeatedAction: result.repeatedAction,
    });

    const base: AgentStateUpdate = {
      observationSignatures: result.signatures,
      noProgressCount: result.noProgressCount,
      progressStuck: result.stuck,
    };

    if (!result.stuck) {
      return base;
    }

    const request = { type: "input" as const, message: STUCK_MESSAGE };

    return {
      ...base,
      decision: {
        type: "human",
        call: null,
        reason: null,
        request,
      },
      humanRequest: request,
      status: "waiting_for_human",
    };
  };
}

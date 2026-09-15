import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  END,
  START,
  StateGraph,
  interrupt,
  MemorySaver,
} from "@langchain/langgraph";

import type { BrowserController } from "../browser/browser";
import type { ToolRegistry } from "../tools/registry";

import { AgentStateSchema, type AgentState,
  type AgentStateUpdate,
} from "./state";

import { createObserveNode } from "./nodes/observe";
import { createDecideNode } from "./nodes/decide";
import { createExecuteNode } from "./nodes/execute";

const DEFAULT_MAX_STEPS = 15;

type CreateAgentGraphOptions = {
  browser: BrowserController;
  model: BaseChatModel;
  registry: ToolRegistry;
  maxSteps?: number;
};

type Route =
  | "execute"
  | "finish"
  | "human"
  | "max_steps";

type HumanResume =
  | {
      action: "resume";
    }
  | {
      action: "cancel";
    };

export function createAgentGraph({
  browser,
  model,
  registry,
  maxSteps = DEFAULT_MAX_STEPS,
}: CreateAgentGraphOptions) {
  const observeNode = createObserveNode(browser);
  const decideNode = createDecideNode(model, registry);
  const executeNode = createExecuteNode(registry);

  function routeDecision(state: AgentState): Route {
    const decision = state.decision;

    if (!decision) {
      throw new Error(
        "cannot route agent state without a decision",
      );
    }

    switch (decision.type) {
      case "tool":
        if (state.stepCount >= maxSteps) {
          return "max_steps";
        }

        return "execute";

      case "finish":
        return "finish";

      case "human":
        return "human";

      default: {
        const exhaustive: never = decision;

        throw new Error(
          `unknown agent decision: ${JSON.stringify(exhaustive)}`,
        );
      }
    }
  }

  function finishNode(
    state: AgentState,
  ): AgentStateUpdate {
    if (state.decision?.type !== "finish") {
      throw new Error(
        "finish node received a non-finish decision",
      );
    }

    // add verification later
    return {
      status: "success",
      humanRequest: null,
      error: null,
    };
  }

  function humanNode(
    state: AgentState,
  ): AgentStateUpdate {

    if (state.decision?.type !== "human") {
      throw new Error(
        "human node received a non-human decision",
      );
    }

    if (!state.decision.request) {
      throw new Error(
        "human node received a human decision without a request",
      );
    }

    const response = interrupt({
      type: "human_request",
      runId: state.runId,
      request: state.decision.request,
    }) as HumanResume;

    if (response.action === "cancel") {
      return {
        status: "cancelled",
        humanRequest: null,
        error: null,
      };
    }

    return {
      status: "running",
      humanRequest: null,
      error: null,
    };
  }

  function maxStepsNode(): AgentStateUpdate {
    return {
      status: "failed",
      error: `Maximum agent step limit (${maxSteps}) reached`,
    };
  }

  const builder = new StateGraph(AgentStateSchema)
    .addNode("observe", observeNode)
    .addNode("decide", decideNode)
    .addNode("execute", executeNode)
    .addNode("finish", finishNode)
    .addNode("human", humanNode)
    .addNode("max_steps", maxStepsNode)

    .addEdge(START, "observe")
    .addEdge("observe", "decide")

    .addConditionalEdges(
      "decide",
      routeDecision,
      {
        execute: "execute",
        finish: "finish",
        human: "human",
        max_steps: "max_steps",
      },
    )

    .addEdge("execute", "observe")

    // After the human resumes, always re-observe the live browser.
    .addEdge("human", "observe")

    .addEdge("finish", END)
    .addEdge("max_steps", END);

  // interrupt() requires a checkpointer
  const checkpointer = new MemorySaver();

  return builder.compile({
    checkpointer,
  });
}

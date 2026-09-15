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

import {
  AgentStateSchema,
  type AgentState,
  type AgentStateUpdate,
} from "./state";

import { createObserveNode } from "./nodes/observe";
import { createDecideNode } from "./nodes/decide";
import { createGuardNode } from "./nodes/guard";
import { createExecuteNode } from "./nodes/execute";

const DEFAULT_MAX_STEPS = 15;

type CreateAgentGraphOptions = {
  browser: BrowserController;
  model: BaseChatModel;
  registry: ToolRegistry;
  maxSteps?: number;
};

type DecideRoute =
  | "guard"
  | "finish"
  | "human"
  | "max_steps"
  | "observe";

type GuardRoute = "human" | "execute";

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
  const guardNode = createGuardNode(browser);
  const executeNode = createExecuteNode(registry);

  function routeDecision(state: AgentState): DecideRoute {
    const decision = state.decision;

    if (!decision) {
      return "observe";
    }

    if (decision.type === "tool") {
      if (state.stepCount >= maxSteps) {
        return "max_steps";
      }
      return "guard";
    }

    if (decision.type === "human") {
      return "human";
    }

    if (decision.type === "finish") {
      return "finish";
    }

    return "observe";
  }

  function routeGuard(state: AgentState): GuardRoute {
    // Guard rewrites a blocked credential tool decision
    // into decision.type === "human".
    if (state.decision?.type === "human") {
      return "human";
    }
    return "execute";
  }

  function finishNode(state: AgentState): AgentStateUpdate {
    if (state.decision?.type !== "finish") {
      throw new Error("finish node received a non-finish decision");
    }

    return {
      status: "success",
      result: state.decision.reason,
      humanRequest: null,
      error: null,
    };
  }

  function humanNode(state: AgentState): AgentStateUpdate {
    if (state.decision?.type !== "human") {
      throw new Error("human node received a non-human decision");
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
    .addNode("guard", guardNode)
    .addNode("execute", executeNode)
    .addNode("finish", finishNode)
    .addNode("human", humanNode)
    .addNode("max_steps", maxStepsNode)

    .addEdge(START, "observe")
    .addEdge("observe", "decide")

    .addConditionalEdges("decide", routeDecision, {
      guard: "guard",
      human: "human",
      finish: "finish",
      max_steps: "max_steps",
      observe: "observe",
    })

    .addConditionalEdges("guard", routeGuard, {
      human: "human",
      execute: "execute",
    })

    .addEdge("execute", "observe")

    // Critical for HITL: after the human resumes, re-observe the live browser.
    // Never replay the blocked credential action.
    .addEdge("human", "observe")

    .addEdge("finish", END)
    .addEdge("max_steps", END);

  const checkpointer = new MemorySaver();

  return builder.compile({
    checkpointer,
  });
}

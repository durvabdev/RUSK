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
import type { ArtifactRepository } from "../artifacts/repository";

import {
  AgentStateSchema,
  type AgentState,
  type AgentStateUpdate,
} from "./state";

import { createObserveNode } from "./nodes/observe";
import { createCheckProgressNode } from "./nodes/check-progress";
import { createDecideNode } from "./nodes/decide";
import { createGuardNode } from "./nodes/guard";
import { createExecuteNode } from "./nodes/execute";
import { createCompileArtifactNode } from "./nodes/compile-artifact";

const DEFAULT_MAX_STEPS = 50;

type CreateAgentGraphOptions = {
  browser: BrowserController;
  model: BaseChatModel;
  registry: ToolRegistry;
  artifactRepository: ArtifactRepository;
  maxSteps?: number;
};

type DecideRoute =
  | "guard"
  | "finish"
  | "human"
  | "max_steps"
  | "observe";

type GuardRoute = "human" | "execute" | "deny";

type HumanResume = { action: "resume" } | { action: "cancel" };

export function createAgentGraph({
  browser,
  model,
  registry,
  artifactRepository,
  maxSteps = DEFAULT_MAX_STEPS,
}: CreateAgentGraphOptions) {
  const observeNode = createObserveNode(browser);
  const checkProgressNode = createCheckProgressNode();
  const decideNode = createDecideNode(model, registry);
  const guardNode = createGuardNode(browser);
  const executeNode = createExecuteNode(registry, browser);
  const compileArtifactNode = createCompileArtifactNode(artifactRepository);

  function routeProgress(state: AgentState): "human" | "decide" {
    return state.progressStuck ? "human" : "decide";
  }

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
    if (state.status === "failed") {
      return "deny";
    }
    if (
      state.decision?.type === "human" ||
      state.status === "waiting_for_human"
    ) {
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
        pendingApproval: null,
        approvalStatus: "none",
      };
    }

    // Resume: human acted in the live browser. Do not auto-execute.
    // Clear pending approval and re-observe.
    return {
      status: "running",
      humanRequest: null,
      error: null,
      pendingApproval: null,
      approvalStatus: "none",
      progressStuck: false,
      noProgressCount: 0,
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
    .addNode("check_progress", checkProgressNode)
    .addNode("decide", decideNode)
    .addNode("guard", guardNode)
    .addNode("execute", executeNode)
    .addNode("finish", finishNode)
    .addNode("compile_artifact", compileArtifactNode)
    .addNode("human", humanNode)
    .addNode("max_steps", maxStepsNode)

    .addEdge(START, "observe")
    .addEdge("observe", "check_progress")
    .addConditionalEdges("check_progress", routeProgress, {
      human: "human",
      decide: "decide",
    })

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
      deny: END,
    })

    .addEdge("execute", "observe")

    // After HUMAN: re-observe. Never auto-execute a blocked/approval action.
    .addEdge("human", "observe")

    .addEdge("finish", "compile_artifact")
    .addEdge("compile_artifact", END)
    .addEdge("max_steps", END);

  const checkpointer = new MemorySaver();

  return builder.compile({
    checkpointer,
  });
}

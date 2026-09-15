import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { ToolRegistry } from "../../tools/registry";
import { AgentDecisionSchema } from "../decision";
import {
  buildModelContext,
  type AgentState,
  type AgentStateUpdate,
} from "../state";

export const ACTOR_SYSTEM_PROMPT = `You are controlling a browser to accomplish the user's goal.

On each turn, use the current browser observation, recent action history, and available tool catalog to choose exactly one next decision.

You may make one of three decisions:

1. tool
Choose exactly one tool from the supplied catalog and provide its required arguments.
For browser element operations, use only element refs that exist in the current snapshot. Never invent a ref.
Do not invent tools, URLs, credentials, approvals, or missing information.

2. finish
Choose finish only when the current browser state provides direct evidence that the user's goal has been resolved.
An attempted action is not evidence of completion.
State the specific observed evidence supporting completion.

A legitimate business outcome that resolves the goal is still completion. Examples include "no such member", "no copies available", or "insufficient balance". Do not request human intervention merely because the outcome is negative.

3. human
Choose human when you cannot safely or reliably continue without a person.

Use the appropriate request type:
- input: required information, credentials, or other user-provided data is missing
- choice: multiple plausible options exist and the goal does not determine which one to choose
- approval: the next action requires explicit human approval
- credential: authentication information is specifically required

Explain what you observed and what is needed to continue.

Never guess credentials, approvals, missing information, or ambiguous choices.

If a tool has repeatedly failed, the page is in an unexpected state, or the available tools cannot safely make progress, request human intervention instead of inventing a workaround.`;

export function createDecideNode(
  model: BaseChatModel,
  registry: ToolRegistry,
) {
  const decisionModel = model.withStructuredOutput(AgentDecisionSchema);

  return async function decideNode(
    state: AgentState,
  ): Promise<AgentStateUpdate> {
    const context = buildModelContext(state);
    const tools = registry.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.schema),
    }));

    const decision = await decisionModel.invoke([
      new SystemMessage(ACTOR_SYSTEM_PROMPT),
      new HumanMessage(JSON.stringify({ context, tools })),
    ]);

    return { decision };
  };
}

import assert from "node:assert/strict";
import { test } from "node:test";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { ToolRegistry } from "../../tools/registry.ts";
import {
  AgentDecisionSchema,
  type AgentDecision,
} from "../decision.ts";
import type { AgentState } from "../state.ts";
import { ACTOR_SYSTEM_PROMPT, createDecideNode } from "./decide.ts";

test("decideNode returns only a structured decision", async () => {
  const elements = [
    {
      tag: "button",
      role: "button",
      text: "Open",
      ariaLabel: null,
      name: null,
      inputType: null,
      href: null,
      placeholder: null,
      contentEditable: false,
      disabled: false,
      readOnly: false,
      value: null,
      visible: true,
    },
  ];
  const modelDecision = {
    type: "tool",
    call: { name: "click", arguments: { ref: "e14" } },
  };
  const expected: AgentDecision = { ...modelDecision, reason: null, request: null };
  let receivedSchema: unknown;
  let receivedMessages: BaseMessage[] = [];
  let invokeCount = 0;

  const model = {
    withStructuredOutput(schema: unknown) {
      receivedSchema = schema;
      return {
        async invoke(messages: BaseMessage[]) {
          receivedMessages = messages;
          return modelDecision;
        },
      };
    },
  } as unknown as BaseChatModel;

  const registry: ToolRegistry = {
    list() {
      return [
        {
          name: "click",
          description: "Click an element.",
          schema: z.object({ ref: z.string() }),
          async execute() {
            throw new Error("must not execute");
          },
        },
      ];
    },
    async invoke() {
      invokeCount += 1;
      return { ok: true };
    },
  };

  const state = {
    runId: "run-1",
    goal: "Open the account",
    observation: {
      url: "https://example.com",
      title: "Example",
      snapshot: '- button "Open" [ref=e14]',
      elements,
    },
    history: [],
    stepCount: 2,
    status: "running",
  } as unknown as AgentState;

  const update = await createDecideNode(model, registry)(state);

  assert.equal(receivedSchema, AgentDecisionSchema);
  assert.equal(receivedMessages[0]?.content, ACTOR_SYSTEM_PROMPT);
  assert.match(
    ACTOR_SYSTEM_PROMPT,
    /Never return a browser tool name such as "navigate", "click", or "type" as\n+the top-level type/,
  );
  assert.match(ACTOR_SYSTEM_PROMPT, /inspect_element/);
  assert.match(ACTOR_SYSTEM_PROMPT, /inspect_dom/);
  assert.match(ACTOR_SYSTEM_PROMPT, /Never invent or infer credentials/);

  const payload = JSON.parse(String(receivedMessages[1]?.content));
  assert.deepEqual(payload.context, {
    goal: "Open the account",
    currentPage: {
      url: "https://example.com",
      title: "Example",
      snapshot: '- button "Open" [ref=e14]',
      elements,
    },
    recentActions: [],
    step: 2,
  });
  assert.equal(payload.tools[0].name, "click");
  assert.equal(payload.tools[0].description, "Click an element.");
  assert.equal(payload.tools[0].parameters.type, "object");

  const jsonSchema = z.toJSONSchema(AgentDecisionSchema);
  assert.deepEqual(jsonSchema.required, ["type"]);

  assert.deepEqual(update, { decision: expected });
  assert.equal(invokeCount, 0);
  assert.equal("history" in update, false);
  assert.equal("stepCount" in update, false);
  assert.equal("observation" in update, false);
  assert.equal("status" in update, false);
});

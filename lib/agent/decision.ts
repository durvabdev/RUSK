import { z } from "zod";
import { HumanRequestSchema } from "./human-request";

const ToolCallSchema = z.object({
  name: z.string(),

  // Tool arguments must be a JSON object.
  // This prevents the model from returning:
  // "{\"ref\":\"e74\"}"
  arguments: z.record(
    z.string(),
    z.unknown(),
  ),
});

export type AgentDecision =
  | {
      type: "tool";
      call: z.infer<typeof ToolCallSchema>;
      reason: null;
      request: null;
    }
  | {
      type: "finish";
      call: null;
      reason: string;
      request: null;
    }
  | {
      type: "human";
      call: null;
      reason: null;
      request: z.infer<typeof HumanRequestSchema>;
    };

// This schema is sent to the model as an OpenAI function definition. It must
// remain permissive because models may omit fields irrelevant to their choice.
// It is deliberately separate from the strict decision stored in graph state.
export const AgentDecisionSchema = z.object({
  type: z.enum(["tool", "finish", "human"]),
  call: ToolCallSchema.nullable().optional(),
  reason: z.string().nullable().optional(),
  request: HumanRequestSchema.nullable().optional(),
});

type ModelDecision = z.infer<typeof AgentDecisionSchema>;

export const AgentDecisionStateSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tool"),
    call: ToolCallSchema,
    reason: z.null(),
    request: z.null(),
  }),
  z.object({
    type: z.literal("finish"),
    call: z.null(),
    reason: z.string(),
    request: z.null(),
  }),
  z.object({
    type: z.literal("human"),
    call: z.null(),
    reason: z.null(),
    request: HumanRequestSchema,
  }),
]);

export function normalizeDecision(decision: ModelDecision): AgentDecision {
  switch (decision.type) {
    case "tool":
      if (!decision.call) {
        throw new Error("tool decision is missing call");
      }
      return {
        type: "tool",
        call: decision.call,
        reason: null,
        request: null,
      };
    case "finish":
      if (!decision.reason) {
        throw new Error("finish decision is missing reason");
      }
      return {
        type: "finish",
        call: null,
        reason: decision.reason,
        request: null,
      };
    case "human":
      if (!decision.request) {
        throw new Error("human decision is missing request");
      }
      return {
        type: "human",
        call: null,
        reason: null,
        request: decision.request,
      };
  }
}

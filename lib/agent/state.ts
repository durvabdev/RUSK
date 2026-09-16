import { ReducedValue, StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { AgentDecisionStateSchema } from "./decision";
import { HumanRequestSchema } from "@/lib/agent/human-request";

/**
 * Compact CDP semantics for perception. They deliberately carry no MCP ref or
 * selector: refs remain grounded only in the accessibility snapshot.
 */
export const ObservedElementSchema = z.object({
  tag: z.string(),
  role: z.string().nullable(),
  text: z.string().nullable(),
  ariaLabel: z.string().nullable(),
  name: z.string().nullable(),
  inputType: z.string().nullable(),
  href: z.string().nullable(),
  placeholder: z.string().nullable(),
  contentEditable: z.boolean(),
  disabled: z.boolean(),
  readOnly: z.boolean(),
  value: z.string().nullable(),
  visible: z.boolean(),
});

export type ObservedElement = z.infer<typeof ObservedElementSchema>;

export const BrowserObservationSchema = z.object({
  url: z.string().optional(),
  title: z.string().optional(),
  snapshot: z.string(),
  elements: z.array(ObservedElementSchema).default(() => []),
});

const ToolCallSchema = z.object({
  name: z.string(),
  arguments: z.unknown(),
});

const ToolResultSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

export const AgentStepSchema = z.object({
  step: z.number(),
  toolCall: ToolCallSchema,
  toolResult: ToolResultSchema,
  timestamp: z.number(),
});

export type AgentStep = z.infer<typeof AgentStepSchema>;

export const AgentStateSchema = new StateSchema({
  runId: z.string(),
  goal: z.string(),
  observation: BrowserObservationSchema.optional(),
  history: new ReducedValue(z.array(AgentStepSchema).default(() => []), {
    inputSchema: AgentStepSchema,
    reducer: (current, step) => [...current, step],
  }),
  stepCount: new ReducedValue(z.number().default(0), {
    inputSchema: z.number(),
    reducer: (current, delta) => current + delta,
  }),
  status: z
    .enum(["running", "success", "failed", "waiting_for_human", "cancelled"])
    .default("running"),
  decision: AgentDecisionStateSchema.optional(),
  // The user-facing outcome supplied when the agent finishes successfully.
  result: z.string().nullable().optional(),
  humanRequest: HumanRequestSchema.nullable().optional(),
  error: z.string().nullable().optional(),
});

export type AgentState = typeof AgentStateSchema.State;
export type AgentStateUpdate = typeof AgentStateSchema.Update;

export function buildModelContext(state: AgentState) {
  return {
    goal: state.goal,

    currentPage: {
      url: state.observation?.url,
      title: state.observation?.title,
      snapshot: state.observation?.snapshot,
      elements: state.observation?.elements ?? [],
    },

    recentActions: state.history.slice(-5).map((step) => ({
      tool: step.toolCall.name,
      arguments: step.toolCall.arguments,
      success: step.toolResult.ok,
      error: step.toolResult.error,
    })),

    step: state.stepCount,
  };
}

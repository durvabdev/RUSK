import { ReducedValue, StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { AgentDecisionSchema } from "./decision";
import { HumanRequestSchema } from "@/lib/agent/human-request";

const BrowserObservationSchema = z.object({
  url: z.string().optional(),
  title: z.string().optional(),
  snapshot: z.string(),
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
  decision: AgentDecisionSchema.optional(),
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

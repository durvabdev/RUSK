import { z } from "zod";
import { HumanRequestSchema } from "./human-request";

export const AgentDecisionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tool"),
    call: z.object({
      name: z.string(),
      arguments: z.unknown(),
    }),
  }),

  z.object({
    type: z.literal("finish"),
    reason: z.string(),
  }),

  z.object({
    type: z.literal("human"),
    request: HumanRequestSchema,
  }),
]);

export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
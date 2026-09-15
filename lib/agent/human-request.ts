import { z } from "zod";

export const HumanRequestSchema = z.object({
  type: z.enum(["approval", "input", "choice", "credential"]),
  message: z.string(),
});

export type HumanRequest = z.infer<typeof HumanRequestSchema>;

import { z } from "zod";

export const ReplayTargetSchema = z.object({
  testId: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
  placeholder: z.string().optional(),
  href: z.string().optional(),
  id: z.string().optional(),
});

export type ReplayTarget = z.infer<typeof ReplayTargetSchema>;

export const ArtifactValueSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("literal"),
    value: z.string(),
  }),
  z.object({
    source: z.literal("input"),
    name: z.string(),
  }),
]);

export type ArtifactValue = z.infer<typeof ArtifactValueSchema>;

const ReplayStepNavigateSchema = z.object({
  action: z.literal("navigate"),
  url: z.string(),
});

const ReplayStepClickSchema = z.object({
  action: z.literal("click"),
  target: ReplayTargetSchema,
});

const ReplayStepTypeSchema = z.object({
  action: z.literal("type"),
  target: ReplayTargetSchema,
  value: ArtifactValueSchema,
});

const ReplayStepSelectSchema = z.object({
  action: z.literal("select"),
  target: ReplayTargetSchema,
  value: ArtifactValueSchema,
});

const ReplayStepPressKeySchema = z.object({
  action: z.literal("press_key"),
  key: z.string(),
});

export const ReplayStepSchema = z.discriminatedUnion("action", [
  ReplayStepNavigateSchema,
  ReplayStepClickSchema,
  ReplayStepTypeSchema,
  ReplayStepSelectSchema,
  ReplayStepPressKeySchema,
]);

export type ReplayStep = z.infer<typeof ReplayStepSchema>;

export const ArtifactInputDefSchema = z.object({
  type: z.literal("string"),
  required: z.boolean(),
  description: z.string().optional(),
});

export const ArtifactOutputSchema = z.object({
  name: z.string(),
  type: z.literal("string"),
  extractor: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("definition"),
      label: z.string(),
    }),
    z.object({
      kind: z.literal("page_text"),
      label: z.string(),
    }),
  ]),
});

export type ArtifactOutput = z.infer<typeof ArtifactOutputSchema>;

export const WorkflowArtifactSchema = z.object({
  id: z.string(),
  version: z.literal(1),
  kind: z.literal("browser_workflow"),
  name: z.string(),
  description: z.string(),
  sourceRunId: z.string(),
  startUrl: z.string(),
  requiresAuthenticatedSession: z.boolean(),
  inputs: z.record(z.string(), ArtifactInputDefSchema),
  steps: z.array(ReplayStepSchema),
  outputs: z.array(ArtifactOutputSchema),
  createdAt: z.string(),
});

export type WorkflowArtifact = z.infer<typeof WorkflowArtifactSchema>;

export type ArtifactRunResult =
  | {
      status: "success";
      outputs: Record<string, string>;
    }
  | {
      status: "failed";
      error: string;
      code:
        | "input_invalid"
        | "target_missing"
        | "target_ambiguous"
        | "output_missing"
        | "output_ambiguous"
        | "step_failed";
    };

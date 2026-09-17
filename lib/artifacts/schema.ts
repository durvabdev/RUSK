import { z } from "zod";

/** Facts captured during a recorded run. Not authoritative for replay. */
export const RecordedTargetSchema = z.object({
  ref: z.string().optional(),
  testId: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
  placeholder: z.string().optional(),
  href: z.string().optional(),
  id: z.string().optional(),
});

export type RecordedTarget = z.infer<typeof RecordedTargetSchema>;

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

export const ReplayScopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("matching_container"),
    value: ArtifactValueSchema,
  }),
]);

export type ReplayScope = z.infer<typeof ReplayScopeSchema>;

/** Generalized replay contract. No dynamic href/id as matchers. */
export const ReplayTargetSchema = z.object({
  testId: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
  placeholder: z.string().optional(),
  within: ReplayScopeSchema.optional(),
});

export type ReplayTarget = z.infer<typeof ReplayTargetSchema>;

export const TextPresentSchema = z.object({
  kind: z.literal("text_present"),
  text: z.string(),
});

export type TextPresent = z.infer<typeof TextPresentSchema>;

export const ArtifactConditionSchema = z.object({
  class: z.enum(["business_outcome", "recoverable"]),
  code: z.string(),
  message: z.string(),
  when: TextPresentSchema,
});

export type ArtifactCondition = z.infer<typeof ArtifactConditionSchema>;

const ReplayStepNavigateSchema = z.object({
  action: z.literal("navigate"),
  url: z.string(),
});

const ReplayStepClickSchema = z.object({
  action: z.literal("click"),
  target: ReplayTargetSchema,
  checkpoint: TextPresentSchema.optional(),
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

const ReplayStepSetCheckedSchema = z.object({
  action: z.literal("set_checked"),
  target: ReplayTargetSchema,
  value: ArtifactValueSchema,
});

export const ReplayStepSchema = z.discriminatedUnion("action", [
  ReplayStepNavigateSchema,
  ReplayStepClickSchema,
  ReplayStepTypeSchema,
  ReplayStepSelectSchema,
  ReplayStepPressKeySchema,
  ReplayStepSetCheckedSchema,
]);

export type ReplayStep = z.infer<typeof ReplayStepSchema>;

/** Form field facts captured before a commit click. Not replay matchers. */
export const RecordedFormFieldSchema = z.object({
  target: RecordedTargetSchema,
  controlType: z.enum(["text", "textarea", "select", "checkbox", "radio"]),
  value: z.union([z.string(), z.boolean()]),
  label: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  options: z.array(z.string()).optional(),
});

export type RecordedFormField = z.infer<typeof RecordedFormFieldSchema>;

export const ArtifactInputDefSchema = z.object({
  type: z.enum(["string", "boolean"]),
  required: z.boolean(),
  description: z.string().optional(),
  default: z.union([z.string(), z.boolean()]).optional(),
});

export type ArtifactInputDef = z.infer<typeof ArtifactInputDefSchema>;

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
  conditions: z.array(ArtifactConditionSchema).default([]),
  /** Terminal success signal — required for replay success. */
  checkpoint: TextPresentSchema,
  createdAt: z.string(),
});

export type WorkflowArtifact = z.infer<typeof WorkflowArtifactSchema>;

export type ReplayContext = {
  stepIndex?: number;
  action?: string;
  expected?: string;
  observed?: string;
  currentUrl?: string;
};

export type ArtifactRunResult =
  | {
      status: "success";
      outputs: Record<string, string>;
    }
  | {
      status: "business_outcome";
      code: string;
      message: string;
      context?: ReplayContext;
    }
  | {
      status: "recoverable";
      code: string;
      message: string;
      retryable: true;
      context?: ReplayContext;
    }
  | {
      status: "failure";
      code: string;
      message: string;
      context?: ReplayContext;
    };

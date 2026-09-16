import { z } from "zod";
import type { BrowserController } from "../browser/browser";
import type {
  ArtifactRunResult,
  WorkflowArtifact,
} from "./schema";
import { replayArtifact } from "./replay";

export type ArtifactTool = {
  name: string;
  description: string;
  inputSchema: z.ZodType<Record<string, unknown>>;
  invoke(
    inputs: Record<string, unknown>,
  ): Promise<ArtifactRunResult>;
};

export function createArtifactTool(
  artifact: WorkflowArtifact,
  browser: BrowserController,
): ArtifactTool {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, def] of Object.entries(artifact.inputs)) {
    shape[key] = def.required
      ? z.string().min(1)
      : z.string().optional();
  }

  const inputSchema = z.object(shape);

  return {
    name: artifact.name,
    description: artifact.description,
    inputSchema,
    invoke: (inputs) =>
      replayArtifact(artifact, inputs, browser),
  };
}
import type { z } from "zod";

export type ToolCall = {
  name: string;
  arguments: unknown;
};

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type ToolDefinition<TInput = unknown> = {
  name: string;
  description: string;
  schema: z.ZodType<TInput>;
  execute(input: TInput): Promise<unknown>;
};

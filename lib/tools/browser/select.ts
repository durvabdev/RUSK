import { z } from "zod";
import type { BrowserController } from "../../browser/browser.ts";
import type { ToolDefinition } from "../types.ts";

const schema = z.object({
  ref: z.string(),
  value: z.string(),
});

export function createSelectTool(
  browser: BrowserController,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: "select",
    description: "Select an option in a dropdown identified by a browser ref.",
    schema,
    execute: ({ ref, value }) => browser.select(ref, value),
  };
}

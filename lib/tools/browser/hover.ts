import { z } from "zod";
import type { BrowserController } from "../../browser/browser.ts";
import type { ToolDefinition } from "../types.ts";

const schema = z.object({
  ref: z.string(),
});

export function createHoverTool(browser: BrowserController): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: "hover",
    description: "Hover the mouse over an element identified by a browser ref.",
    schema,
    execute: ({ ref }) => browser.hover(ref),
  };
}

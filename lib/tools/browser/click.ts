import { z } from "zod";
import type { BrowserController } from "../../browser/browser";
import type { ToolDefinition } from "../types";

const schema = z.object({
  ref: z.string(),
});

export function createClickTool(browser: BrowserController): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: "click",
    description: "Click an element identified by a browser ref.",
    schema,
    execute: ({ ref }) => browser.click(ref),
  };
}

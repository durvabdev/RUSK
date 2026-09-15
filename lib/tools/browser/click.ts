import { z } from "zod";
import type { BrowserController } from "../../browser/browser";
import type { ToolDefinition } from "../types";

const schema = z.object({
  ref: z.string(),
});

export function createClickTool(browser: BrowserController): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: "click",
    description: "Click a specific interactive control using its snapshot ref. Prefer this when the page exposes a button, link, tab, checkbox, or other explicit control that directly represents the intended action.",
    schema,
    execute: ({ ref }) => browser.click(ref),
  };
}

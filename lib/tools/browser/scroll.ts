import { z } from "zod";
import type { BrowserController } from "../../browser/browser.ts";
import type { ToolDefinition } from "../types.ts";

const schema = z.object({
  direction: z.enum(["up", "down"]),
});

export function createScrollTool(
  browser: BrowserController,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: "scroll",
    description: "Scroll the page viewport up or down by roughly one screen.",
    schema,
    execute: ({ direction }) => browser.scroll(direction),
  };
}

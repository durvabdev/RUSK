import { z } from "zod";
import type { BrowserController } from "../../browser/browser";
import type { ToolDefinition } from "../types";

const schema = z.object({
  url: z.string(),
});

export function createNavigateTool(
  browser: BrowserController,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: "navigate",
    description: "Navigate the browser to a URL.",
    schema,
    execute: ({ url }) => browser.navigate(url),
  };
}

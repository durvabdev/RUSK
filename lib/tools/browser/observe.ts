import { z } from "zod";
import type { BrowserController } from "../../browser/browser.ts";
import type { ToolDefinition } from "../types.ts";

const schema = z.object({});

export function createObserveTool(
  browser: BrowserController,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: "observe",
    description: "Capture the current page accessibility snapshot.",
    schema,
    execute: () => browser.observe(),
  };
}

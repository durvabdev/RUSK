import { z } from "zod";
import type { BrowserController } from "../../browser/browser";
import type { ToolDefinition } from "../types";

const schema = z.object({});

export function createGoBackTool(
  browser: BrowserController,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: "go_back",
    description: "Navigate the current tab back one history entry.",
    schema,
    execute: () => browser.goBack(),
  };
}

import { z } from "zod";
import type { BrowserController } from "../../browser/browser";
import type { ToolDefinition } from "../types";

const schema = z.object({
  key: z.string(),
});

export function createPressKeyTool(
  browser: BrowserController,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: "press_key",
    description: "Press a keyboard key.",
    schema,
    execute: ({ key }) => browser.pressKey(key),
  };
}

import { z } from "zod";
import type { BrowserController } from "../../browser/browser";
import type { ToolDefinition } from "../types";

const schema = z.object({
  ref: z.string(),
  text: z.string(),
});

export function createTypeTool(browser: BrowserController): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: "type",
    description: "Enter text into an editable field whose purpose matches the information being entered. Do not use unrelated search or filter fields as a shortcut for interacting with other page controls.",
    schema,
    execute: ({ ref, text }) => browser.type(ref, text),
  };
}

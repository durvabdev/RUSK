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
    description: "Type text into an element identified by a browser ref.",
    schema,
    execute: ({ ref, text }) => browser.type(ref, text),
  };
}

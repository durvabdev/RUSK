import { z } from "zod";
import type { BrowserController } from "../../browser/browser";
import type { ToolDefinition } from "../types";

const schema = z.object({
  ref: z.string(),
});

export function createInspectElementTool(
  browser: BrowserController,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: "inspect_element",
    description:
      "Inspect a snapshot ref and return structured DOM metadata (tag, role, editable state, rect). Use when a ref is ambiguous or before retrying a failed click/type.",
    schema,
    execute: ({ ref }) => browser.inspectElement(ref),
  };
}

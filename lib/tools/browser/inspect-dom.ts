import { z } from "zod";
import type { BrowserController } from "../../browser/browser";
import { MAX_DOM_CANDIDATE_LIMIT } from "../../browser/dom-inspect";
import type { ToolDefinition } from "../types";

const schema = z.object({
  limit: z.number().int().min(1).max(MAX_DOM_CANDIDATE_LIMIT).optional(),
});

export function createInspectDomTool(
  browser: BrowserController,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: "inspect_dom",
    description:
      "List a compact set of useful DOM candidates on the current page (buttons, inputs, links, editable regions). Use when the accessibility snapshot is too coarse to choose a target.",
    schema,
    execute: ({ limit }) => browser.inspectDom(limit),
  };
}

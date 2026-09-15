import type { BrowserController } from "../../browser/browser.ts";
import type { ToolDefinition } from "../types.ts";
import { createClickTool } from "./click.ts";
import { createNavigateTool } from "./navigate.ts";
import { createObserveTool } from "./observe.ts";
import { createPressKeyTool } from "./press-key.ts";
import { createSelectTool } from "./select.ts";
import { createTypeTool } from "./type.ts";

export function createBrowserTools(browser: BrowserController): ToolDefinition[] {
  return [
    createClickTool(browser),
    createTypeTool(browser),
    createNavigateTool(browser),
    createSelectTool(browser),
    createPressKeyTool(browser),
    createObserveTool(browser),
  ];
}

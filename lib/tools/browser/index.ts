import type { BrowserController } from "../../browser/browser";
import type { ToolDefinition } from "../types";
import { createClickTool } from "./click";
import { createGoBackTool } from "./go-back";
import { createHoverTool } from "./hover";
import { createNavigateTool } from "./navigate";
import { createObserveTool } from "./observe";
import { createPressKeyTool } from "./press-key";
import { createScrollTool } from "./scroll";
import { createSelectTool } from "./select";
import { createTypeTool } from "./type";

export function createBrowserTools(browser: BrowserController): ToolDefinition[] {
  return [
    createClickTool(browser),
    createTypeTool(browser),
    createNavigateTool(browser),
    createSelectTool(browser),
    createPressKeyTool(browser),
    createObserveTool(browser),
    createHoverTool(browser),
    createGoBackTool(browser),
    createScrollTool(browser),
  ];
}

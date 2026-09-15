import type { BrowserController } from "../../browser/browser";
import type { ToolDefinition } from "../types";
import { createClickTool } from "./click";
import { createGoBackTool } from "./go-back";
import { createHoverTool } from "./hover";
import { createInspectDomTool } from "./inspect-dom";
import { createInspectElementTool } from "./inspect-element";
import { createNavigateTool } from "./navigate";
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
    createHoverTool(browser),
    createGoBackTool(browser),
    createScrollTool(browser),
    createInspectElementTool(browser),
    createInspectDomTool(browser),
  ];
}

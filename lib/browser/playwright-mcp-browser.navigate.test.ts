import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractJsonObject,
  navigateMcpCall,
  parseInspectPayload,
  PlaywrightToolError,
} from "./playwright-mcp-browser.ts";
import { createRegistry } from "../tools/registry.ts";
import { createInspectElementTool } from "../tools/browser/inspect-element.ts";
import type { BrowserController } from "./browser.ts";

test("navigate always uses browser_navigate for the current tab", () => {
  const call = navigateMcpCall("https://www.calculator.net/");
  assert.equal(call.name, "browser_navigate");
  assert.deepEqual(call.arguments, { url: "https://www.calculator.net/" });
});

test("PlaywrightToolError is identifiable for session preservation", () => {
  const err = new PlaywrightToolError("not editable");
  assert.equal(err.name, "PlaywrightToolError");
  assert.ok(err instanceof PlaywrightToolError);
  assert.ok(err instanceof Error);
});

test("parseInspectPayload handles ### Result wrappers and trailing braces", () => {
  const text = `### Result
{ "tag": "input", "role": null, "text": null, "ariaLabel": null, "name": "username", "type": "text", "href": null, "placeholder": null, "autocomplete": "username", "contentEditable": false, "disabled": false, "readOnly": false, "value": null, "rect": { "x": 1, "y": 2, "width": 3, "height": 4 } }
### Ran Playwright code
await page.evaluate(() => { return {}; });
`;
  const parsed = parseInspectPayload(text);
  assert.equal(parsed.name, "username");
  assert.equal(parsed.autocomplete, "username");
  assert.equal(parsed.contentEditable, false);
  assert.equal(parsed.rect.width, 3);

  const extracted = extractJsonObject(text);
  assert.ok(extracted?.startsWith("{"));
  assert.ok(extracted?.endsWith("}"));
});

test("inspect_element tool returns registry ok:false on controller failure", async () => {
  const browser = {
    async inspectElement() {
      throw new PlaywrightToolError("stale ref");
    },
  } as unknown as BrowserController;

  const registry = createRegistry([createInspectElementTool(browser)]);
  const result = await registry.invoke({
    name: "inspect_element",
    arguments: { ref: "e66" },
  });

  assert.equal(result.ok, false);
  assert.match(String(result.error), /stale ref/);
});

test("inspect_element tool delegates ref to controller", async () => {
  let seen: string | undefined;
  const browser = {
    async inspectElement(ref: string) {
      seen = ref;
      return {
        tag: "button",
        role: "button",
        text: "2",
        ariaLabel: null,
        name: null,
        type: null,
        href: null,
        placeholder: null,
        autocomplete: null,
        testId: null,
        contentEditable: false,
        disabled: false,
        readOnly: false,
        value: null,
        rect: { x: 1, y: 2, width: 3, height: 4 },
      };
    },
  } as unknown as BrowserController;

  const registry = createRegistry([createInspectElementTool(browser)]);
  const result = await registry.invoke({
    name: "inspect_element",
    arguments: { ref: "e14" },
  });

  assert.equal(seen, "e14");
  assert.equal(result.ok, true);
  assert.equal((result.data as { tag: string }).tag, "button");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserController } from "../browser/browser.ts";
import { createBrowserTools } from "./browser/index.ts";
import { createRegistry } from "./registry.ts";

function mockBrowser(): BrowserController {
  return {
    async observe() {
      return { snapshot: "mock", elements: [] };
    },
    async navigate(url) {
      return { ok: true, text: `navigated:${url}` };
    },
    async click(ref) {
      return { ok: true, text: `clicked:${ref}` };
    },
    async type(ref, text) {
      return { ok: true, text: `typed:${ref}:${text}` };
    },
    async select(ref, value) {
      return { ok: true, text: `selected:${ref}:${value}` };
    },
    async pressKey(key) {
      return { ok: true, text: `pressed:${key}` };
    },
    async hover(ref) {
      return { ok: true, text: `hovered:${ref}` };
    },
    async goBack() {
      return { ok: true, text: "went_back" };
    },
    async scroll(direction) {
      return { ok: true, text: `scrolled:${direction}` };
    },
  };
}

const registry = createRegistry(createBrowserTools(mockBrowser()));

test("valid hover", async () => {
  const result = await registry.invoke({
    name: "hover",
    arguments: { ref: "e17" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { ok: true, text: "hovered:e17" });
});

test("valid go_back", async () => {
  const result = await registry.invoke({
    name: "go_back",
    arguments: {},
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { ok: true, text: "went_back" });
});

test("valid scroll down", async () => {
  const result = await registry.invoke({
    name: "scroll",
    arguments: { direction: "down" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { ok: true, text: "scrolled:down" });
});

test("invalid scroll direction", async () => {
  const result = await registry.invoke({
    name: "scroll",
    arguments: { direction: "sideways" },
  });
  assert.equal(result.ok, false);
});

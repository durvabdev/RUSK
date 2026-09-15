import assert from "node:assert/strict";
import { test } from "node:test";
import type { Browser, Page } from "playwright";
import { pickActivePage } from "./playwright-mcp-browser.ts";
import { createBrowserTools } from "../tools/browser/index.ts";
import type { BrowserController } from "./browser.ts";

function fakePage(url: string): Page {
  return { url: () => url } as Page;
}

function fakeBrowser(urls: string[]): Browser {
  return {
    contexts: () => [
      {
        pages: () => urls.map(fakePage),
      },
    ],
  } as unknown as Browser;
}

test("pickActivePage prefers matching URL then last non-blank", () => {
  const browser = fakeBrowser([
    "about:blank",
    "https://example.com/a",
    "https://www.calculator.net/",
  ]);
  assert.equal(
    pickActivePage(browser, "https://www.calculator.net/").url(),
    "https://www.calculator.net/",
  );
  assert.equal(
    pickActivePage(browser).url(),
    "https://www.calculator.net/",
  );
});

test("createBrowserTools exposes inspect tools and not observe", () => {
  const browser = {} as BrowserController;
  const names = createBrowserTools(browser).map((tool) => tool.name);
  assert.ok(names.includes("inspect_element"));
  assert.ok(names.includes("inspect_dom"));
  assert.ok(names.includes("navigate"));
  assert.equal(names.includes("observe"), false);
});

import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium, type Browser, type Page } from "playwright";
import type {
  BrowserActionResult,
  BrowserController,
  BrowserObservation,
  DomInspection,
  ElementInspection,
} from "./browser";
import { ensureChromium } from "./chromium";
import {
  DOM_TEXT_MAX_LEN,
  evaluateDomCandidates,
} from "./dom-inspect";

const mcpCli = path.join(
  process.cwd(),
  "node_modules",
  "@playwright",
  "mcp",
  "cli.js",
);

type G = typeof globalThis & {
  ruskMcp?: Promise<Client>;
  ruskMcpLock?: Promise<unknown>;
  ruskMcpArgs?: string;
  ruskCdpBrowser?: Promise<Browser>;
  ruskLastPageUrl?: string;
};

const g = globalThis as G;

/** A tool-level rejection means the browser is still usable. */
export class PlaywrightToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaywrightToolError";
  }
}

/** Always navigate the current tab — never open a new one. */
export function navigateMcpCall(url: string) {
  return {
    name: "browser_navigate" as const,
    arguments: { url },
  };
}

/** Fixed inspector — never accept model-supplied JavaScript. */
export const INSPECT_ELEMENT_FN = String.raw`(element) => {
  const max = ${DOM_TEXT_MAX_LEN};
  const trim = (value) => {
    if (value == null) return null;
    const normalized = String(value).replace(/\s+/g, " ").trim();
    if (!normalized) return null;
    return normalized.length <= max
      ? normalized
      : normalized.slice(0, max - 1) + "…";
  };
  const rect = element.getBoundingClientRect();
  return {
    tag: element.tagName ? element.tagName.toLowerCase() : null,
    role: element.getAttribute("role"),
    text: trim(element.textContent),
    ariaLabel: trim(element.getAttribute("aria-label")),
    name: trim(element.getAttribute("name") || element.name),
    type: trim(element.getAttribute("type") || element.type),
    href: trim(element.href || element.getAttribute("href")),
    placeholder: trim(element.getAttribute("placeholder") || element.placeholder),
    autocomplete: trim(element.getAttribute("autocomplete") || element.autocomplete),
    contentEditable:
      element.isContentEditable === true ||
      element.getAttribute("contenteditable") === "true",
    disabled: Boolean(
      element.disabled || element.getAttribute("aria-disabled") === "true",
    ),
    readOnly: Boolean(element.readOnly),
    value: trim(typeof element.value === "string" ? element.value : null),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}`;

function toolText(result: unknown) {
  if (
    typeof result !== "object" ||
    result === null ||
    !("content" in result) ||
    !Array.isArray((result as { content: unknown }).content)
  ) {
    throw new PlaywrightToolError(
      "Playwright MCP returned an unexpected result shape",
    );
  }
  const typed = result as {
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  const text = typed.content
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n");
  if (typed.isError || !text) {
    throw new PlaywrightToolError(
      text || "Playwright MCP returned an empty result",
    );
  }
  return text;
}

function pageMeta(snapshot: string) {
  const url = snapshot.match(/^- Page URL: (.+)$/m)?.[1];
  const title = snapshot.match(/^- Page Title: (.+)$/m)?.[1];
  return {
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
  };
}

async function mcpArgs(): Promise<string[]> {
  const { cdpEndpoint } = await ensureChromium();
  return [
    mcpCli,
    "--snapshot-mode",
    "none",
    "--caps",
    "vision",
    "--cdp-endpoint",
    cdpEndpoint,
    "--idle-timeout",
    "0",
  ];
}

async function connectClient() {
  const args = await mcpArgs();
  console.log("[mcp] starting", process.execPath, ...args);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args,
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    console.error("[playwright-mcp]", chunk.toString());
  });
  transport.onerror = (err) => {
    console.error("[mcp transport error]", err);
  };
  transport.onclose = () => {
    console.error("[mcp transport closed]");
  };
  const client = new Client({ name: "rusk", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

async function getClient() {
  const args = await mcpArgs();
  const argKey = args.join("\0");
  if (g.ruskMcpArgs !== argKey) {
    const prev = g.ruskMcp;
    g.ruskMcp = undefined;
    g.ruskMcpArgs = argKey;
    if (prev) void prev.then((c) => c.close()).catch(() => {});
  }
  if (!g.ruskMcp) {
    g.ruskMcp = connectClient().catch((err) => {
      g.ruskMcp = undefined;
      throw err;
    });
  }
  return g.ruskMcp;
}

async function getCdpBrowser(): Promise<Browser> {
  if (!g.ruskCdpBrowser) {
    g.ruskCdpBrowser = (async () => {
      const { cdpEndpoint } = await ensureChromium();
      console.log("[cdp] connectOverCDP", cdpEndpoint);
      return chromium.connectOverCDP(cdpEndpoint);
    })().catch((err) => {
      g.ruskCdpBrowser = undefined;
      throw err;
    });
  }
  return g.ruskCdpBrowser;
}

export function pickActivePage(
  browser: Browser,
  preferredUrl?: string,
): Page {
  const pages = browser.contexts().flatMap((context) => context.pages());
  if (pages.length === 0) {
    throw new PlaywrightToolError("No pages available on CDP browser");
  }

  if (preferredUrl) {
    const exact = pages.find((page) => page.url() === preferredUrl);
    if (exact) return exact;
    const prefix = pages.find(
      (page) =>
        page.url().startsWith(preferredUrl) ||
        preferredUrl.startsWith(page.url()),
    );
    if (prefix) return prefix;
  }

  const real = pages.filter(
    (page) => page.url() && page.url() !== "about:blank",
  );
  if (real.length > 0) {
    return real[real.length - 1]!;
  }
  return pages[pages.length - 1]!;
}

function withLock<T>(fn: () => Promise<T>) {
  const prev = g.ruskMcpLock ?? Promise.resolve();
  const next = prev.then(fn, fn);
  g.ruskMcpLock = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  return withLock(async () => {
    const client = await getClient();
    try {
      return await fn(client);
    } catch (err) {
      console.error("[MCP] call failed", err);

      // Tool-level failures keep the shared Chromium + MCP session alive.
      if (err instanceof PlaywrightToolError) {
        throw err;
      }

      g.ruskMcp = undefined;
      const cdp = g.ruskCdpBrowser;
      g.ruskCdpBrowser = undefined;
      try {
        await client.close();
      } catch {
        /* already dead */
      }
      if (cdp) {
        try {
          await (await cdp).close();
        } catch {
          /* already dead */
        }
      }
      // Keep RUSK-owned Chromium alive; next call reconnects MCP/CDP to it.
      throw err;
    }
  });
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<BrowserActionResult> {
  const text = toolText(await client.callTool({ name, arguments: args }));
  return { ok: true, text };
}

function keyboardKey(character: string) {
  if (character === " ") return "Space";
  if (character === "\n") return "Enter";
  return character;
}

/** First complete `{...}` object, ignoring markdown wrappers like `### Result`. */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

export function parseInspectPayload(text: string): ElementInspection {
  const json = extractJsonObject(text);
  if (!json) {
    throw new PlaywrightToolError(
      `inspect_element did not return JSON: ${text.slice(0, 200)}`,
    );
  }
  try {
    return JSON.parse(json) as ElementInspection;
  } catch {
    throw new PlaywrightToolError(
      `inspect_element returned invalid JSON: ${text.slice(0, 200)}`,
    );
  }
}

export function getBrowser(): BrowserController {
  return {
    async observe(): Promise<BrowserObservation> {
      return withClient(async (client) => {
        console.log("[MCP] taking snapshot");
        const snapshot = toolText(
          await client.callTool({ name: "browser_snapshot", arguments: {} }),
        );
        console.log("[MCP] snapshot complete");
        const meta = pageMeta(snapshot);
        if (meta.url) g.ruskLastPageUrl = meta.url;
        return { snapshot, ...meta };
      });
    },

    async navigate(url: string): Promise<BrowserActionResult> {
      return withClient(async (client) => {
        console.log("[MCP] navigating", url);
        const { name, arguments: args } = navigateMcpCall(url);
        const result = await call(client, name, args);
        console.log("[MCP] navigate complete");
        g.ruskLastPageUrl = url;
        return result;
      });
    },

    click(ref: string) {
      return withClient((client) =>
        call(client, "browser_click", { target: ref }),
      );
    },

    type(ref: string, text: string) {
      return withClient(async (client) => {
        try {
          return await call(client, "browser_type", { target: ref, text });
        } catch (err) {
          if (!(err instanceof PlaywrightToolError)) throw err;

          // Some rich editors (including MathQuill) expose an editable div
          // but reject Playwright's fill-based `browser_type`. A click plus
          // key events is the equivalent user interaction for those widgets.
          await call(client, "browser_click", { target: ref });
          for (const character of text) {
            await call(client, "browser_press_key", {
              key: keyboardKey(character),
            });
          }
          return {
            ok: true,
            text: "Entered text with keyboard events after fill was rejected.",
          };
        }
      });
    },

    select(ref: string, value: string) {
      return withClient((client) =>
        call(client, "browser_select_option", {
          target: ref,
          values: [value],
        }),
      );
    },

    pressKey(key: string) {
      return withClient((client) =>
        call(client, "browser_press_key", { key }),
      );
    },

    hover(ref: string) {
      return withClient((client) =>
        call(client, "browser_hover", { target: ref }),
      );
    },

    goBack() {
      return withClient((client) => call(client, "browser_navigate_back", {}));
    },

    scroll(direction: "up" | "down") {
      // ponytail: fixed ~1 viewport; expose pixels only if the agent needs finer control
      const deltaY = direction === "down" ? 800 : -800;
      return withClient((client) =>
        call(client, "browser_mouse_wheel", { deltaX: 0, deltaY }),
      );
    },

    async inspectElement(ref: string): Promise<ElementInspection> {
      return withClient(async (client) => {
        const text = toolText(
          await client.callTool({
            name: "browser_evaluate",
            arguments: {
              target: ref,
              element: `snapshot ref ${ref}`,
              function: INSPECT_ELEMENT_FN,
            },
          }),
        );
        return parseInspectPayload(text);
      });
    },

    async inspectDom(limit?: number): Promise<DomInspection> {
      return withLock(async () => {
        // Ensure MCP/Chromium are up so a page exists, then inspect via CDP.
        await getClient();
        const browser = await getCdpBrowser();
        const page = pickActivePage(browser, g.ruskLastPageUrl);
        const candidates = await evaluateDomCandidates(page, limit);
        g.ruskLastPageUrl = page.url();
        return {
          url: page.url(),
          title: await page.title(),
          candidates,
        };
      });
    },
  };
}

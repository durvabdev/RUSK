import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { BrowserActionResult, BrowserController, BrowserObservation } from "./browser";

const mcpCli = path.join(process.cwd(), "node_modules", "@playwright", "mcp", "cli.js");
const mcpArgs = [mcpCli, "--snapshot-mode", "none", "--caps", "vision"];

type G = typeof globalThis & {
  ruskMcp?: Promise<Client>;
  ruskMcpLock?: Promise<unknown>;
  ruskMcpArgs?: string;
  ruskHasWindow?: boolean;
};

const g = globalThis as G;

/** A tool-level rejection means the browser is still usable. */
class PlaywrightToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaywrightToolError";
  }
}

function toolText(result: unknown) {
  // #region agent log
  fetch("http://127.0.0.1:7664/ingest/fd9e0927-3b2b-4655-99d8-b10f5823d4d8", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "ff1940",
    },
    body: JSON.stringify({
      sessionId: "ff1940",
      runId: "post-fix",
      hypothesisId: "B",
      location: "playwright-mcp-browser.ts:toolText",
      message: "toolText input shape",
      data: {
        isObject: typeof result === "object" && result !== null,
        hasContent:
          typeof result === "object" &&
          result !== null &&
          "content" in result,
        hasToolResult:
          typeof result === "object" &&
          result !== null &&
          "toolResult" in result,
        keys:
          typeof result === "object" && result !== null
            ? Object.keys(result as object).slice(0, 8)
            : [],
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
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

async function connectClient() {
  console.log("[mcp] starting", process.execPath, ...mcpArgs);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [...mcpArgs],
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

function getClient() {
  // ponytail: one process-wide browser; restart MCP if the child dies
  const argKey = mcpArgs.join("\0");
  if (g.ruskMcpArgs !== argKey) {
    const prev = g.ruskMcp;
    g.ruskMcp = undefined;
    g.ruskMcpArgs = argKey;
    g.ruskHasWindow = false;
    if (prev) void prev.then((c) => c.close()).catch(() => {});
  }
  if (!g.ruskMcp) {
    g.ruskMcp = connectClient().catch((err) => {
      g.ruskMcp = undefined;
      g.ruskHasWindow = false;
      throw err;
    });
  }
  return g.ruskMcp;
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

      // A Playwright action can be rejected while its browser and page remain
      // healthy (for example, `fill` on Desmos's MathQuill content div). Keep
      // that session alive so the following observation can use the current
      // page instead of a newly launched, blank browser.
      if (err instanceof PlaywrightToolError) {
        throw err;
      }

      g.ruskMcp = undefined;
      g.ruskHasWindow = false;
      try {
        await client.close();
      } catch {
        /* already dead */
      }
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

export function getBrowser(): BrowserController {
  return {
    async observe(): Promise<BrowserObservation> {
      return withClient(async (client) => {
        console.log("[MCP] taking snapshot");
        const snapshot = toolText(
          await client.callTool({ name: "browser_snapshot", arguments: {} }),
        );
        console.log("[MCP] snapshot complete");
        return { snapshot, ...pageMeta(snapshot) };
      });
    },

    async navigate(url: string): Promise<BrowserActionResult> {
      return withClient(async (client) => {
        console.log("[MCP] navigating", url);
        const result = g.ruskHasWindow
          ? await call(client, "browser_tabs", { action: "new", url })
          : await call(client, "browser_navigate", { url });
        console.log("[MCP] navigate complete");
        g.ruskHasWindow = true;
        return result;
      });
    },

    click(ref: string) {
      return withClient((client) => call(client, "browser_click", { target: ref }));
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
        call(client, "browser_select_option", { target: ref, values: [value] }),
      );
    },

    pressKey(key: string) {
      return withClient((client) => call(client, "browser_press_key", { key }));
    },

    hover(ref: string) {
      return withClient((client) => call(client, "browser_hover", { target: ref }));
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
  };
}

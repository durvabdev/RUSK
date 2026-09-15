import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { BrowserActionResult, BrowserController, BrowserObservation } from "./browser";

const mcpCli = path.join(process.cwd(), "node_modules", "@playwright", "mcp", "cli.js");
const mcpArgs = [mcpCli, "--snapshot-mode", "none"];

type G = typeof globalThis & {
  ruskMcp?: Promise<Client>;
  ruskMcpLock?: Promise<unknown>;
  ruskMcpArgs?: string;
  ruskHasWindow?: boolean;
};

const g = globalThis as G;

function toolText(result: { content: Array<{ type: string; text?: string }>; isError?: boolean }) {
  const text = result.content
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n");
  if (result.isError || !text) {
    throw new Error(text || "Playwright MCP returned an empty result");
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
      return withClient((client) =>
        call(client, "browser_type", { target: ref, text }),
      );
    },

    select(ref: string, value: string) {
      return withClient((client) =>
        call(client, "browser_select_option", { target: ref, values: [value] }),
      );
    },

    pressKey(key: string) {
      return withClient((client) => call(client, "browser_press_key", { key }));
    },
  };
}

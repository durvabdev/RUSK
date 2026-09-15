import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

async function snapshotUrl(url: string) {
  return withLock(async () => {
    let client = await getClient();
    try {
      console.log("[MCP] navigating", url);
      const opened = g.ruskHasWindow
        ? await client.callTool({
            name: "browser_tabs",
            arguments: { action: "new", url },
          })
        : await client.callTool({
            name: "browser_navigate",
            arguments: { url },
          });
      if (opened.isError) toolText(opened);
      console.log("[MCP] navigate complete");
      g.ruskHasWindow = true;
      console.log("[MCP] taking snapshot");
      const snapshot = toolText(
        await client.callTool({
          name: "browser_snapshot",
          arguments: {},
        }),
      );
      console.log("[MCP] snapshot complete");
      return snapshot;
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

export async function POST(request: Request) {
  let body: { url?: unknown; goal?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "url and goal are required" },
      { status: 400 },
    );
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (!url || !goal) {
    return NextResponse.json(
      { error: "url and goal are required" },
      { status: 400 },
    );
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error();
    }
  } catch {
    return NextResponse.json(
      { error: "url must be a valid http(s) URL" },
      { status: 400 },
    );
  }

  const id = crypto.randomUUID();
  try {
    const snapshot = await snapshotUrl(url);
    return NextResponse.json(
      { id, url, goal, status: "created", snapshot },
      { status: 201 },
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { id, url, goal, status: "failed", error },
      { status: 201 },
    );
  }
}

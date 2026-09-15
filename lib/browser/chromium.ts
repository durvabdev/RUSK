import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { chromium } from "playwright";

export const RUSK_USER_DATA_DIR = path.join(process.cwd(), ".rusk-browser");

type G = typeof globalThis & {
  ruskChromium?: Promise<ChromiumHandle>;
};

const g = globalThis as G;

export type ChromiumHandle = {
  port: number;
  /** HTTP CDP endpoint Playwright MCP and connectOverCDP accept. */
  cdpEndpoint: string;
  wsEndpoint: string;
  process: ChildProcess;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findFreePort(): Promise<number> {
  const configured = process.env.RUSK_CDP_PORT;
  if (configured) {
    const port = Number(configured);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`Invalid RUSK_CDP_PORT: ${configured}`);
    }
    return port;
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate a CDP port"));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitForCdp(port: number): Promise<{ wsEndpoint: string }> {
  const url = `http://127.0.0.1:${port}/json/version`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`CDP version HTTP ${response.status}`);
      }
      const body = (await response.json()) as { webSocketDebuggerUrl?: string };
      if (!body.webSocketDebuggerUrl) {
        throw new Error("CDP version response missing webSocketDebuggerUrl");
      }
      return { wsEndpoint: body.webSocketDebuggerUrl };
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`Chromium CDP endpoint did not become ready on port ${port}`);
}

async function launchChromium(): Promise<ChromiumHandle> {
  fs.mkdirSync(RUSK_USER_DATA_DIR, { recursive: true });

  const port = await findFreePort();
  const executablePath = chromium.executablePath();
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${RUSK_USER_DATA_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
  ];

  if (process.env.RUSK_HEADLESS === "true") {
    args.push("--headless=new");
  }

  args.push("about:blank");

  console.log("[chromium] starting", executablePath, ...args);

  const child = spawn(executablePath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stderr?.on("data", (chunk) => {
    console.error("[chromium]", chunk.toString());
  });

  child.on("exit", (code, signal) => {
    console.error("[chromium] exited", { code, signal });
    g.ruskChromium = undefined;
  });

  try {
    const { wsEndpoint } = await waitForCdp(port);
    return {
      port,
      cdpEndpoint: `http://127.0.0.1:${port}`,
      wsEndpoint,
      process: child,
    };
  } catch (err) {
    child.kill("SIGTERM");
    throw err;
  }
}

/** Process-wide Chromium owned by RUSK. MCP and Playwright attach via CDP. */
export function ensureChromium(): Promise<ChromiumHandle> {
  if (!g.ruskChromium) {
    g.ruskChromium = launchChromium().catch((err) => {
      g.ruskChromium = undefined;
      throw err;
    });
  }
  return g.ruskChromium;
}

export async function resetChromium(): Promise<void> {
  const current = g.ruskChromium;
  g.ruskChromium = undefined;
  if (!current) return;
  try {
    const handle = await current;
    handle.process.kill("SIGTERM");
  } catch {
    /* already dead */
  }
}

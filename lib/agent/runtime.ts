import type { BrowserController } from "../browser/browser";
import { ChatOpenAI } from "@langchain/openai";
import { ensureChromium } from "../browser/chromium";
import { getBrowser } from "../browser/playwright-mcp-browser";
import { createArtifactRepository } from "../artifacts/repository";
import { createBrowserTools } from "../tools/browser";
import { createRegistry } from "../tools/registry";
import { createAgentGraph } from "./graph";

type AgentGraph = ReturnType<typeof createAgentGraph>;

type AgentRuntime = {
  graph: AgentGraph;
  browser: BrowserController;
};

let runtimePromise: Promise<AgentRuntime> | null = null;

export function getAgentRuntime(): Promise<AgentRuntime> {
  if (!runtimePromise) {
    runtimePromise = createRuntime();
  }
  return runtimePromise;
}

async function createRuntime(): Promise<AgentRuntime> {
  await ensureChromium();
  const browser = getBrowser();

  const model = new ChatOpenAI({
    model: "gpt-5.6-terra",
    maxTokens: 1000,
    maxRetries: 3,
    timeout: 10_000,
    useResponsesApi: true,
    apiKey: process.env.OPENAI_API_KEY,
    configuration: process.env.OPENAI_BASE_URL
      ? { baseURL: process.env.OPENAI_BASE_URL }
      : undefined,
  });

  // #region agent log
  {
    const params = (
      model as unknown as { invocationParams: (o?: object) => Record<string, unknown> }
    ).invocationParams({});
    fetch("http://127.0.0.1:7664/ingest/fd9e0927-3b2b-4655-99d8-b10f5823d4d8", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "78d987",
      },
      body: JSON.stringify({
        sessionId: "78d987",
        runId: "pre-fix",
        hypothesisId: "A",
        location: "lib/agent/runtime.ts:createRuntime",
        message: "ChatOpenAI responses invocation params",
        data: {
          model: "gpt-5.6-terra",
          useResponsesApi: true,
          hasTemperatureKey: Object.prototype.hasOwnProperty.call(params, "temperature"),
          temperature: params.temperature ?? null,
          max_output_tokens: params.max_output_tokens ?? null,
          paramKeys: Object.keys(params),
          baseURLSet: Boolean(process.env.OPENAI_BASE_URL),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion

  const registry = createRegistry(createBrowserTools(browser));
  const artifactRepository = createArtifactRepository();
  const graph = createAgentGraph({
    browser,
    model,
    registry,
    artifactRepository,
  });

  return { graph, browser };
}

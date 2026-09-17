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

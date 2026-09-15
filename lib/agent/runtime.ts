import type { BrowserController } from "../browser/browser";
import { ChatOpenAI } from "@langchain/openai";
import { getBrowser } from "../browser/playwright-mcp-browser";
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
  const browser = getBrowser();

  const model = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0.1,
    maxTokens: 1000,
    maxRetries: 3,
    timeout: 10_000,
    apiKey: process.env.OPENAI_API_KEY,
    configuration: process.env.OPENAI_BASE_URL
      ? { baseURL: process.env.OPENAI_BASE_URL }
      : undefined,
  });

  const registry = createRegistry(createBrowserTools(browser));
  const graph = createAgentGraph({ browser, model, registry });

  return { graph, browser };
}
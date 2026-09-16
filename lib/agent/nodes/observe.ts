import type { BrowserController } from "../../browser/browser";
import { appendRunEvent } from "../../evidence/run-log";
import type { AgentState, AgentStateUpdate } from "../state";

export function createObserveNode(browser: BrowserController) {
  return async function observeNode(
    state: AgentState,
  ): Promise<AgentStateUpdate> {
    const observation = await browser.observe();

    await appendRunEvent(state.runId, {
      event: "observation",
      url: observation.url ?? null,
      title: observation.title ?? null,
    });

    return { observation };
  };
}

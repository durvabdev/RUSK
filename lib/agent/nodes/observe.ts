import type { BrowserController } from "../../browser/browser";
import type { AgentState, AgentStateUpdate } from "../state";

export function createObserveNode(browser: BrowserController) {
  return async function observeNode(
    _state: AgentState,
  ): Promise<AgentStateUpdate> {
    const observation = await browser.observe();
    return { observation };
  };
}

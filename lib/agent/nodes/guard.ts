import type { BrowserController } from "../../browser/browser";
import {
  CREDENTIAL_HUMAN_REQUEST,
  detectAuthFormFromDom,
  fromElementInspection,
  isCredentialField,
} from "../auth-form";
import type { AgentState, AgentStateUpdate } from "../state";

function typeRef(arguments_: unknown): string | null {
  if (
    typeof arguments_ !== "object" ||
    arguments_ === null ||
    !("ref" in arguments_)
  ) {
    return null;
  }
  const ref = (arguments_ as { ref: unknown }).ref;
  return typeof ref === "string" && ref.length > 0 ? ref : null;
}

export function createGuardNode(browser: BrowserController) {
  return async function guardNode(
    state: AgentState,
  ): Promise<AgentStateUpdate> {
    const decision = state.decision;

    if (!decision || decision.type !== "tool" || !decision.call) {
      return {};
    }

    if (decision.call.name !== "type") {
      return {};
    }

    const ref = typeRef(decision.call.arguments);
    if (!ref) {
      return {};
    }

    const { candidates } = await browser.inspectDom();
    const auth = detectAuthFormFromDom(candidates);

    if (!auth.isAuthForm) {
      return {};
    }

    const target = await browser.inspectElement(ref);
    if (!isCredentialField(fromElementInspection(target))) {
      return {};
    }

    // Do not execute type, do not record typed text in history, do not log secrets.
    return {
      decision: {
        type: "human",
        call: null,
        reason: null,
        request: CREDENTIAL_HUMAN_REQUEST,
      },
      humanRequest: CREDENTIAL_HUMAN_REQUEST,
      status: "waiting_for_human",
    };
  };
}

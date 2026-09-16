import type { BrowserController } from "../../browser/browser";
import {
  evaluateActionPolicy,
  type PolicyElementMeta,
} from "../../policy/evaluate";
import { getPolicyConfig } from "../../policy/config";
import {
  CREDENTIAL_HUMAN_REQUEST,
  detectAuthFormFromDom,
  fromElementInspection,
  isCredentialField,
} from "../auth-form";
import type { AgentState, AgentStateUpdate } from "../state";

function toolRef(arguments_: unknown): string | null {
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

function toolUrl(arguments_: unknown): string | null {
  if (
    typeof arguments_ !== "object" ||
    arguments_ === null ||
    !("url" in arguments_)
  ) {
    return null;
  }
  const url = (arguments_ as { url: unknown }).url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

export const POLICY_APPROVAL_REQUEST = {
  type: "approval" as const,
  message:
    "Risky action requires human approval. Approve or take control in the live browser, then resume.",
};

function policyDenyUpdate(
  code: string,
  message: string,
): AgentStateUpdate {
  return {
    status: "failed",
    error: `${code}: ${message}`,
    decision: {
      type: "finish",
      call: null,
      reason: message,
      request: null,
    },
  };
}

export function createGuardNode(browser: BrowserController) {
  return async function guardNode(
    state: AgentState,
  ): Promise<AgentStateUpdate> {
    const decision = state.decision;

    if (!decision || decision.type !== "tool" || !decision.call) {
      return {};
    }

    const call = decision.call;
    const ref = toolRef(call.arguments);

    // --- Credential guard (type on auth forms only) ---
    if (call.name === "type" && ref) {
      const { candidates } = await browser.inspectDom();
      const auth = detectAuthFormFromDom(candidates);

      if (auth.isAuthForm) {
        let target;
        try {
          target = await browser.inspectElement(ref);
        } catch {
          return {
            decision: {
              type: "human",
              call: null,
              reason: null,
              request: CREDENTIAL_HUMAN_REQUEST,
            },
            humanRequest: CREDENTIAL_HUMAN_REQUEST,
            status: "waiting_for_human",
            authRequired: true,
          };
        }

        if (isCredentialField(fromElementInspection(target))) {
          return {
            decision: {
              type: "human",
              call: null,
              reason: null,
              request: CREDENTIAL_HUMAN_REQUEST,
            },
            humanRequest: CREDENTIAL_HUMAN_REQUEST,
            status: "waiting_for_human",
            authRequired: true,
          };
        }
      }
    }

    // --- Shared action policy (before any execute) ---
    let element: PolicyElementMeta | null = null;
    if (ref && ["click", "type", "select"].includes(call.name)) {
      try {
        const inspected = await browser.inspectElement(ref);
        element = {
          risk: inspected.risk,
          actionCategory: inspected.actionCategory,
          role: inspected.role,
          name: inspected.name,
          href: inspected.href,
          type: inspected.type,
          text: inspected.text,
        };
      } catch {
        element = null;
      }
    }

    const policy = evaluateActionPolicy(
      {
        action: call.name,
        currentUrl: state.observation?.url ?? null,
        navigateUrl:
          call.name === "navigate" ? toolUrl(call.arguments) : null,
        element,
      },
      getPolicyConfig(),
    );

    if (policy.ok) {
      return {};
    }

    if (policy.code === "policy_requires_human") {
      return {
        decision: {
          type: "human",
          call: null,
          reason: null,
          request: POLICY_APPROVAL_REQUEST,
        },
        humanRequest: POLICY_APPROVAL_REQUEST,
        status: "waiting_for_human",
      };
    }

    return policyDenyUpdate(policy.code, policy.message);
  };
}

import type { DomCandidate } from "./dom-inspect";

/**
 * CDP-derived page semantics included with every observation. These are not
 * MCP targets: the actor must ground an action independently in the snapshot.
 */
export type ObservedElement = Omit<DomCandidate, "rect" | "selector">;

export type BrowserObservation = {
  url?: string;
  title?: string;
  snapshot: string;
  elements: ObservedElement[];
};

export type BrowserActionResult = {
  ok: boolean;
  text?: string;
};

export type ElementInspection = {
  tag: string | null;
  role: string | null;
  text: string | null;
  ariaLabel: string | null;
  name: string | null;
  type: string | null;
  href: string | null;
  placeholder: string | null;
  autocomplete: string | null;
  testId: string | null;
  contentEditable: boolean;
  disabled: boolean;
  readOnly: boolean;
  value: string | null;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type DomInspection = {
  url: string;
  title: string;
  candidates: import("./dom-inspect").DomCandidate[];
};

export interface BrowserController {
  observe(): Promise<BrowserObservation>;

  navigate(url: string): Promise<BrowserActionResult>;

  click(ref: string): Promise<BrowserActionResult>;

  type(ref: string, text: string): Promise<BrowserActionResult>;

  select(ref: string, value: string): Promise<BrowserActionResult>;

  pressKey(key: string): Promise<BrowserActionResult>;

  hover(ref: string): Promise<BrowserActionResult>;

  goBack(): Promise<BrowserActionResult>;

  scroll(direction: "up" | "down"): Promise<BrowserActionResult>;

  /** MCP-ref inspection via fixed browser_evaluate (no model-supplied JS). */
  inspectElement(ref: string): Promise<ElementInspection>;

  /** Compact DOM candidates via Playwright connectOverCDP. */
  inspectDom(limit?: number): Promise<DomInspection>;
}

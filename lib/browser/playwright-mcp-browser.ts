import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium, type Browser, type Page } from "playwright";
import type {
  BrowserActionResult,
  BrowserController,
  BrowserObservation,
  DomInspection,
  ElementInspection,
} from "./browser";
import { ensureChromium } from "./chromium";
import {
  DOM_TEXT_MAX_LEN,
  evaluateDomCandidates,
} from "./dom-inspect";

const mcpCli = path.join(
  process.cwd(),
  "node_modules",
  "@playwright",
  "mcp",
  "cli.js",
);

type G = typeof globalThis & {
  ruskMcp?: Promise<Client>;
  ruskMcpLock?: Promise<unknown>;
  ruskMcpArgs?: string;
  ruskCdpBrowser?: Promise<Browser>;
  ruskLastPageUrl?: string;
};

const g = globalThis as G;

/** A tool-level rejection means the browser is still usable. */
export class PlaywrightToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaywrightToolError";
  }
}

/** Always navigate the current tab — never open a new one. */
export function navigateMcpCall(url: string) {
  return {
    name: "browser_navigate" as const,
    arguments: { url },
  };
}

/** Fixed inspector — never accept model-supplied JavaScript. */
export const INSPECT_ELEMENT_FN = String.raw`(element) => {
  const max = ${DOM_TEXT_MAX_LEN};
  const trim = (value) => {
    if (value == null) return null;
    const normalized = String(value).replace(/\s+/g, " ").trim();
    if (!normalized) return null;
    return normalized.length <= max
      ? normalized
      : normalized.slice(0, max - 1) + "…";
  };
  const rect = element.getBoundingClientRect();
  return {
    tag: element.tagName ? element.tagName.toLowerCase() : null,
    role: element.getAttribute("role"),
    text: trim(element.textContent),
    ariaLabel: trim(element.getAttribute("aria-label")),
    name: trim(element.getAttribute("name") || element.name),
    type: trim(element.getAttribute("type") || element.type),
    href: trim(element.href || element.getAttribute("href")),
    placeholder: trim(element.getAttribute("placeholder") || element.placeholder),
    autocomplete: trim(element.getAttribute("autocomplete") || element.autocomplete),
    testId: trim(element.getAttribute("data-testid")),
    risk: (() => {
      const r = element.getAttribute("data-risk");
      return r === "safe" || r === "reversible_mutation" || r === "risky"
        ? r
        : null;
    })(),
    actionCategory: trim(element.getAttribute("data-action-category")),
    contentEditable:
      element.isContentEditable === true ||
      element.getAttribute("contenteditable") === "true",
    disabled: Boolean(
      element.disabled || element.getAttribute("aria-disabled") === "true",
    ),
    readOnly: Boolean(element.readOnly),
    value: trim(typeof element.value === "string" ? element.value : null),
    checked: (() => {
      const tag = element.tagName ? element.tagName.toLowerCase() : "";
      const role = element.getAttribute("role");
      const type = (element.getAttribute("type") || element.type || "").toLowerCase();
      if (
        type === "checkbox" ||
        type === "radio" ||
        role === "checkbox" ||
        role === "radio" ||
        role === "switch"
      ) {
        if (typeof element.checked === "boolean") return element.checked;
        return element.getAttribute("aria-checked") === "true";
      }
      return null;
    })(),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}`;

/** Fixed — capture configurable form fields near a commit control. */
export const CAPTURE_FORM_FIELDS_FN = String.raw`(element) => {
  const max = ${DOM_TEXT_MAX_LEN};
  const trim = (value) => {
    if (value == null) return null;
    const normalized = String(value).replace(/\s+/g, " ").trim();
    if (!normalized) return null;
    return normalized.length <= max
      ? normalized
      : normalized.slice(0, max - 1) + "…";
  };

  const EXCLUDED_TYPES = new Set([
    "hidden", "password", "submit", "button", "image", "reset", "file",
  ]);
  const TOKEN_NAME =
    /(^|[_-])(csrf|token|authenticity_token|nonce|session)([_-]|$)/i;

  function isVisible(el) {
    const html = el;
    const style = window.getComputedStyle(html);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }
    const rect = html.getBoundingClientRect();
    return rect.width >= 1 && rect.height >= 1;
  }

  function labelFor(el) {
    if (el.id) {
      const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lab) return trim(lab.textContent);
    }
    const wrap = el.closest("label");
    if (wrap) return trim(wrap.textContent);
    const aria = trim(el.getAttribute("aria-label"));
    if (aria) return aria;
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy.split(/\\s+/).map((id) => {
        const node = document.getElementById(id);
        return node ? trim(node.textContent) : null;
      }).filter(Boolean);
      if (parts.length) return parts.join(" ");
    }
    return null;
  }

  function accessibleName(el) {
    return (
      labelFor(el) ||
      trim(el.getAttribute("aria-label")) ||
      trim(el.getAttribute("name") || el.name) ||
      trim(el.getAttribute("placeholder") || el.placeholder) ||
      null
    );
  }

  function countEditable(root) {
    if (!root || !root.querySelectorAll) return 0;
    let n = 0;
    for (const el of root.querySelectorAll(
      "input, textarea, select, [contenteditable='true'], [role='checkbox'], [role='radio'], [role='switch']",
    )) {
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute("type") || el.type || "").toLowerCase();
      if (tag === "input" && EXCLUDED_TYPES.has(type)) continue;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      n += 1;
    }
    return n;
  }

  function resolveScope(commitEl) {
    if (commitEl.form) return commitEl.form;
    const form = commitEl.closest("form");
    if (form) return form;
    const candidates = [
      commitEl.closest("[role='dialog']"),
      commitEl.closest("section"),
      commitEl.closest("main"),
      commitEl.closest("article"),
      commitEl.parentElement,
    ];
    for (const c of candidates) {
      if (c && countEditable(c) > 0) return c;
    }
    return null;
  }

  const scope = resolveScope(element);
  if (!scope) return { fields: [] };

  const fields = [];
  const seen = new Set();

  const nodes = scope.querySelectorAll(
    "input, textarea, select, [contenteditable='true'], [role='checkbox'], [role='radio'], [role='switch']",
  );

  for (const el of nodes) {
    if (seen.has(el)) continue;
    seen.add(el);

    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    const type = (el.getAttribute("type") || el.type || "").toLowerCase();
    const htmlName = trim(el.getAttribute("name") || el.name);

    if (tag === "input" && EXCLUDED_TYPES.has(type)) continue;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
    if (el.readOnly && el.getAttribute("contenteditable") !== "true") continue;
    if (!isVisible(el)) continue;
    if (htmlName && TOKEN_NAME.test(htmlName)) continue;

    let controlType = null;
    let value = null;
    let options = undefined;

    if (tag === "select" || role === "combobox" || role === "listbox") {
      controlType = "select";
      if (tag === "select") {
        const selected = el.options && el.selectedIndex >= 0
          ? el.options[el.selectedIndex]
          : null;
        value =
          trim(selected && (selected.label || selected.text || selected.value)) ||
          trim(el.value) ||
          "";
        options = Array.from(el.options || [])
          .filter((o) => !o.disabled)
          .map((o) => trim(o.label || o.text || o.value))
          .filter(Boolean);
      } else {
        value = trim(el.getAttribute("aria-valuetext") || el.textContent) || "";
      }
      if (!value) continue;
    } else if (
      type === "checkbox" ||
      role === "checkbox" ||
      role === "switch"
    ) {
      controlType = "checkbox";
      value =
        typeof el.checked === "boolean"
          ? el.checked
          : el.getAttribute("aria-checked") === "true";
    } else if (type === "radio" || role === "radio") {
      controlType = "radio";
      const checked =
        typeof el.checked === "boolean"
          ? el.checked
          : el.getAttribute("aria-checked") === "true";
      if (!checked) continue;
      value =
        trim(el.getAttribute("value") || el.value) ||
        accessibleName(el) ||
        "true";
    } else if (tag === "textarea") {
      controlType = "textarea";
      value = trim(el.value) || "";
      if (!value) continue;
    } else if (
      tag === "input" ||
      el.getAttribute("contenteditable") === "true" ||
      role === "textbox" ||
      role === "searchbox"
    ) {
      controlType = "text";
      value =
        trim(
          typeof el.value === "string"
            ? el.value
            : el.getAttribute("contenteditable") === "true"
              ? el.textContent
              : null,
        ) || "";
      if (!value) continue;
    } else {
      continue;
    }

    const label = accessibleName(el);
    const placeholder = trim(el.getAttribute("placeholder") || el.placeholder);
    const testId = trim(el.getAttribute("data-testid"));
    const a11yRole =
      role ||
      (controlType === "select"
        ? "combobox"
        : controlType === "checkbox"
          ? "checkbox"
          : controlType === "radio"
            ? "radio"
            : controlType === "textarea"
              ? "textbox"
              : "textbox");

    const target = {};
    if (testId) target.testId = testId;
    if (a11yRole) target.role = a11yRole;
    if (label) target.name = label;
    else if (htmlName) target.name = htmlName;
    if (placeholder) target.placeholder = placeholder;

    fields.push({
      target,
      controlType,
      value,
      label: label,
      name: htmlName,
      ...(options ? { options } : {}),
    });
  }

  return { fields };
}`;

/** Fixed — list <option> value/label for select debugging/matching. */
export const LIST_SELECT_OPTIONS_FN = String.raw`(element) => {
  const trim = (value) => {
    if (value == null) return null;
    const normalized = String(value).replace(/\s+/g, " ").trim();
    return normalized || null;
  };
  if (!element || String(element.tagName).toLowerCase() !== "select") {
    return {
      tag: element && element.tagName ? element.tagName.toLowerCase() : null,
      options: [],
    };
  }
  return {
    tag: "select",
    id: trim(element.id),
    name: trim(element.name),
    options: Array.from(element.options || []).map((opt, index) => ({
      index,
      value: trim(opt.value),
      label: trim(opt.label || opt.text),
      text: trim(opt.text),
      disabled: Boolean(opt.disabled),
    })),
  };
}`;

export type SelectOptionMeta = {
  index: number;
  value: string | null;
  label: string | null;
  text: string | null;
  disabled?: boolean;
};

/**
 * Map agent-facing option text to the real option value.
 * Snapshot labels often omit balances; values are often account ids.
 */
export function resolveSelectOption(
  options: SelectOptionMeta[],
  requested: string,
): { value: string; strategy: string } | null {
  const needle = requested.trim();
  if (!needle) return null;
  const lower = needle.toLowerCase();
  const enabled = options.filter((o) => !o.disabled);

  const pick = (
    matches: SelectOptionMeta[],
    strategy: string,
  ): { value: string; strategy: string } | null => {
    if (matches.length !== 1) return null;
    const v = matches[0]!.value;
    if (v == null || v === "") return null;
    return { value: v, strategy };
  };

  const exactValue = pick(
    enabled.filter((o) => o.value === needle),
    "exact-value",
  );
  if (exactValue) return exactValue;

  const exactLabel = pick(
    enabled.filter((o) => o.label === needle || o.text === needle),
    "exact-label",
  );
  if (exactLabel) return exactLabel;

  // "Savings SV-2010" → "Savings SV-2010 ($29,975.00)"
  const labelIncludes = pick(
    enabled.filter((o) => {
      const label = (o.label ?? o.text ?? "").toLowerCase();
      return label.includes(lower);
    }),
    "label-includes",
  );
  if (labelIncludes) return labelIncludes;

  const valueFuzzy = pick(
    enabled.filter((o) => {
      const v = (o.value ?? "").toLowerCase();
      return v === lower || (v.length > 0 && (lower.includes(v) || v.includes(lower)));
    }),
    "value-fuzzy",
  );
  if (valueFuzzy) return valueFuzzy;

  return null;
}

function toolText(result: unknown) {
  if (
    typeof result !== "object" ||
    result === null ||
    !("content" in result) ||
    !Array.isArray((result as { content: unknown }).content)
  ) {
    throw new PlaywrightToolError(
      "Playwright MCP returned an unexpected result shape",
    );
  }
  const typed = result as {
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  const text = typed.content
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n");
  if (typed.isError || !text) {
    throw new PlaywrightToolError(
      text || "Playwright MCP returned an empty result",
    );
  }
  return text;
}

function pageMeta(snapshot: string) {
  const url = snapshot.match(/^- Page URL: (.+)$/m)?.[1];
  const title = snapshot.match(/^- Page Title: (.+)$/m)?.[1];
  return {
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
  };
}

async function mcpArgs(): Promise<string[]> {
  const { cdpEndpoint } = await ensureChromium();
  return [
    mcpCli,
    "--snapshot-mode",
    "none",
    "--caps",
    "vision",
    "--cdp-endpoint",
    cdpEndpoint,
    "--idle-timeout",
    "0",
  ];
}

async function connectClient() {
  const args = await mcpArgs();
  console.log("[mcp] starting", process.execPath, ...args);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args,
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

async function getClient() {
  const args = await mcpArgs();
  const argKey = args.join("\0");
  if (g.ruskMcpArgs !== argKey) {
    const prev = g.ruskMcp;
    g.ruskMcp = undefined;
    g.ruskMcpArgs = argKey;
    if (prev) void prev.then((c) => c.close()).catch(() => {});
  }
  if (!g.ruskMcp) {
    g.ruskMcp = connectClient().catch((err) => {
      g.ruskMcp = undefined;
      throw err;
    });
  }
  return g.ruskMcp;
}

async function getCdpBrowser(): Promise<Browser> {
  const existing = g.ruskCdpBrowser;
  if (existing) {
    try {
      const browser = await existing;
      if (browser.isConnected()) return browser;
    } catch {
      // A failed connection promise is replaced below.
    }

    if (g.ruskCdpBrowser === existing) {
      g.ruskCdpBrowser = undefined;
    } else {
      // Another caller replaced the stale connection while this caller waited.
      return getCdpBrowser();
    }
  }

  let connectionPromise: Promise<Browser>;
  connectionPromise = (async () => {
    const { cdpEndpoint } = await ensureChromium();
    console.log("[cdp] connectOverCDP", cdpEndpoint);
    const browser = await chromium.connectOverCDP(cdpEndpoint);

    browser.once("disconnected", () => {
      if (g.ruskCdpBrowser === connectionPromise) {
        console.log("[cdp] disconnected; clearing cached connection");
        g.ruskCdpBrowser = undefined;
      }
    });

    return browser;
  })().catch((err) => {
    if (g.ruskCdpBrowser === connectionPromise) {
      g.ruskCdpBrowser = undefined;
    }
    throw err;
  });

  g.ruskCdpBrowser = connectionPromise;
  return connectionPromise;
}

function getCdpPages(browser: Browser): Page[] {
  return browser.contexts().flatMap((context) => context.pages());
}

function pickActivePageFromPages(
  pages: Page[],
  preferredUrl?: string,
): Page {
  if (pages.length === 0) {
    throw new PlaywrightToolError("No pages available on CDP browser");
  }

  if (preferredUrl) {
    const exact = pages.find((page) => page.url() === preferredUrl);
    if (exact) return exact;
    const prefix = pages.find(
      (page) =>
        page.url().startsWith(preferredUrl) ||
        preferredUrl.startsWith(page.url()),
    );
    if (prefix) return prefix;
  }

  const real = pages.filter(
    (page) => page.url() && page.url() !== "about:blank",
  );
  if (real.length > 0) {
    return real[real.length - 1]!;
  }
  return pages[pages.length - 1]!;
}

export function pickActivePage(
  browser: Browser,
  preferredUrl?: string,
): Page {
  return pickActivePageFromPages(getCdpPages(browser), preferredUrl);
}

const PAGE_RETRY_COUNT = 3;
const PAGE_RETRY_DELAY_MS = 100;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function getActiveCdpPage(preferredUrl?: string): Promise<Page> {
  for (let attempt = 0; attempt < PAGE_RETRY_COUNT; attempt += 1) {
    const browser = await getCdpBrowser();

    if (browser.isConnected()) {
      const pages = getCdpPages(browser);
      if (pages.length > 0) {
        return pickActivePageFromPages(pages, preferredUrl);
      }
    }

    if (attempt < PAGE_RETRY_COUNT - 1) {
      console.warn("[cdp] no pages yet; retrying", { attempt: attempt + 1 });
      await sleep(PAGE_RETRY_DELAY_MS);
    }
  }

  throw new PlaywrightToolError("No pages available on CDP browser");
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

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  return withLock(async () => {
    const client = await getClient();
    try {
      return await fn(client);
    } catch (err) {
      console.error("[MCP] call failed", err);

      // Tool-level failures keep the shared Chromium + MCP session alive.
      if (err instanceof PlaywrightToolError) {
        throw err;
      }

      g.ruskMcp = undefined;
      g.ruskCdpBrowser = undefined;
      try {
        await client.close();
      } catch {
        /* already dead */
      }
      // Keep RUSK-owned Chromium alive; next call reconnects MCP/CDP to it.
      throw err;
    }
  });
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<BrowserActionResult> {
  const text = toolText(await client.callTool({ name, arguments: args }));
  return { ok: true, text };
}

function keyboardKey(character: string) {
  if (character === " ") return "Space";
  if (character === "\n") return "Enter";
  return character;
}

/** First complete `{...}` object, ignoring markdown wrappers like `### Result`. */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

export function parseInspectPayload(text: string): ElementInspection {
  const json = extractJsonObject(text);
  if (!json) {
    throw new PlaywrightToolError(
      `inspect_element did not return JSON: ${text.slice(0, 200)}`,
    );
  }
  try {
    return JSON.parse(json) as ElementInspection;
  } catch {
    throw new PlaywrightToolError(
      `inspect_element returned invalid JSON: ${text.slice(0, 200)}`,
    );
  }
}

export function parseCaptureFormFieldsPayload(
  text: string,
): import("../artifacts/schema").RecordedFormField[] {
  const json = extractJsonObject(text);
  if (!json) {
    throw new PlaywrightToolError(
      `captureFormFields did not return JSON: ${text.slice(0, 200)}`,
    );
  }
  try {
    const parsed = JSON.parse(json) as {
      fields?: import("../artifacts/schema").RecordedFormField[];
    };
    return Array.isArray(parsed.fields) ? parsed.fields : [];
  } catch {
    throw new PlaywrightToolError(
      `captureFormFields returned invalid JSON: ${text.slice(0, 200)}`,
    );
  }
}

export function getBrowser(): BrowserController {
  return {
    async observe(): Promise<BrowserObservation> {
      const snapshotObservation = await withClient(async (client) => {
        console.log("[MCP] taking snapshot");
        const snapshot = toolText(
          await client.callTool({ name: "browser_snapshot", arguments: {} }),
        );
        console.log("[MCP] snapshot complete");
        const meta = pageMeta(snapshot);
        if (meta.url) g.ruskLastPageUrl = meta.url;
        return { snapshot, ...meta };
      });

      // CDP semantics are normal perception, while the MCP snapshot remains
      // the independent source of action refs. Do not derive refs from these
      // candidates or expose their selectors to the actor.
      const inspection = await this.inspectDom();
      return {
        ...snapshotObservation,
        elements: inspection.candidates.map(
          ({ rect: _rect, selector: _selector, ...element }) => element,
        ),
      };
    },

    async navigate(url: string): Promise<BrowserActionResult> {
      return withClient(async (client) => {
        console.log("[MCP] navigating", url);
        const { name, arguments: args } = navigateMcpCall(url);
        const result = await call(client, name, args);
        console.log("[MCP] navigate complete");
        g.ruskLastPageUrl = url;
        return result;
      });
    },

    click(ref: string) {
      return withClient((client) =>
        call(client, "browser_click", { target: ref }),
      );
    },

    type(ref: string, text: string) {
      return withClient(async (client) => {
        try {
          return await call(client, "browser_type", { target: ref, text });
        } catch (err) {
          if (!(err instanceof PlaywrightToolError)) throw err;

          // Some rich editors (including MathQuill) expose an editable div
          // but reject Playwright's fill-based `browser_type`. A click plus
          // key events is the equivalent user interaction for those widgets.
          await call(client, "browser_click", { target: ref });
          for (const character of text) {
            await call(client, "browser_press_key", {
              key: keyboardKey(character),
            });
          }
          return {
            ok: true,
            text: "Entered text with keyboard events after fill was rejected.",
          };
        }
      });
    },

    select(ref: string, value: string) {
      return withClient(async (client) => {
        let opts: SelectOptionMeta[] = [];
        try {
          const raw = toolText(
            await client.callTool({
              name: "browser_evaluate",
              arguments: {
                target: ref,
                element: `snapshot ref ${ref}`,
                function: LIST_SELECT_OPTIONS_FN,
              },
            }),
          );
          const json = extractJsonObject(raw);
          if (json) {
            const parsed = JSON.parse(json) as { options?: SelectOptionMeta[] };
            if (Array.isArray(parsed.options)) opts = parsed.options;
          }
        } catch {
          /* fall through with requested value */
        }
        const selectValue = resolveSelectOption(opts, value)?.value ?? value;
        return call(client, "browser_select_option", {
          target: ref,
          values: [selectValue],
        });
      });
    },
    pressKey(key: string) {
      return withClient((client) =>
        call(client, "browser_press_key", { key }),
      );
    },

    hover(ref: string) {
      return withClient((client) =>
        call(client, "browser_hover", { target: ref }),
      );
    },

    goBack() {
      return withClient((client) => call(client, "browser_navigate_back", {}));
    },

    scroll(direction: "up" | "down") {
      // ponytail: fixed ~1 viewport; expose pixels only if the agent needs finer control
      const deltaY = direction === "down" ? 800 : -800;
      return withClient((client) =>
        call(client, "browser_mouse_wheel", { deltaX: 0, deltaY }),
      );
    },

    async inspectElement(ref: string): Promise<ElementInspection> {
      return withClient(async (client) => {
        const text = toolText(
          await client.callTool({
            name: "browser_evaluate",
            arguments: {
              target: ref,
              element: `snapshot ref ${ref}`,
              function: INSPECT_ELEMENT_FN,
            },
          }),
        );
        return parseInspectPayload(text);
      });
    },

    async captureFormFields(commitRef: string) {
      return withClient(async (client) => {
        const text = toolText(
          await client.callTool({
            name: "browser_evaluate",
            arguments: {
              target: commitRef,
              element: `snapshot ref ${commitRef}`,
              function: CAPTURE_FORM_FIELDS_FN,
            },
          }),
        );
        return parseCaptureFormFieldsPayload(text);
      });
    },

    async inspectDom(limit?: number): Promise<DomInspection> {
      return withLock(async () => {
        // Ensure MCP/Chromium are up so a page exists, then inspect via CDP.
        await getClient();
        const page = await getActiveCdpPage(g.ruskLastPageUrl);
        const candidates = await evaluateDomCandidates(page, limit);
        g.ruskLastPageUrl = page.url();
        return {
          url: page.url(),
          title: await page.title(),
          candidates,
        };
      });
    },

    async screenshot(filePath: string): Promise<boolean> {
      try {
        return await withLock(async () => {
          await getClient();
          const page = await getActiveCdpPage(g.ruskLastPageUrl);
          await page.screenshot({ path: filePath, fullPage: true });
          return true;
        });
      } catch {
        return false;
      }
    },
  };
}

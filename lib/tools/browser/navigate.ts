import { z } from "zod";

import type { BrowserController } from "../../browser/browser";
import type { ToolDefinition } from "../types";

const schema = z.object({
  url: z.string(),
});

export function createNavigateTool(
  browser: BrowserController,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: "navigate",

    description:
      "Navigate to a URL explicitly available from the current page or user goal. Relative URLs are resolved against the current page.",

    schema,

    async execute({ url }) {
      // Absolute URL — use directly.
      try {
        const absolute = new URL(url);

        if (
          absolute.protocol !== "http:" &&
          absolute.protocol !== "https:"
        ) {
          throw new Error(
            `Unsupported URL protocol: ${absolute.protocol}`,
          );
        }

        return browser.navigate(absolute.toString());
      } catch {
        // Not absolute — resolve against current page.
      }

      const observation = await browser.observe();

      if (!observation.url) {
        throw new Error(
          `Cannot resolve relative URL "${url}" because the current page URL is unknown`,
        );
      }

      const resolved = new URL(
        url,
        observation.url,
      );

      if (
        resolved.protocol !== "http:" &&
        resolved.protocol !== "https:"
      ) {
        throw new Error(
          `Unsupported URL protocol: ${resolved.protocol}`,
        );
      }

      return browser.navigate(resolved.toString());
    },
  };
}
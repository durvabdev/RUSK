import type { ToolCall, ToolDefinition, ToolResult } from "./types";

export type ToolRegistry = {
  invoke(call: ToolCall): Promise<ToolResult>;
  list(): ToolDefinition[];
};

export function createRegistry(tools: ToolDefinition[]): ToolRegistry {
  const byName = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    if (byName.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    byName.set(tool.name, tool);
  }

  return {
    list() {
      return [...byName.values()];
    },

    async invoke(call: ToolCall): Promise<ToolResult> {
      const tool = byName.get(call.name);
      if (!tool) {
        return { ok: false, error: `Unknown tool: ${call.name}` };
      }

      const parsed = tool.schema.safeParse(call.arguments);
      if (!parsed.success) {
        return { ok: false, error: parsed.error.message };
      }

      try {
        const data = await tool.execute(parsed.data);
        return { ok: true, data };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

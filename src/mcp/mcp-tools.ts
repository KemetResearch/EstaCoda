import type { MCPServerConfig } from "../config/runtime-config.js";
import type { RegisteredTool, ToolResult } from "../contracts/tool.js";
import { MCPClient, type MCPPromptDescriptor, type MCPResourceDescriptor, type MCPToolDescriptor } from "./mcp-client.js";

export type MCPServerSnapshot = {
  name: string;
  transport: string;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  tools: string[];
  available: boolean;
  error?: string;
};

export type LoadedMCPServer = {
  name: string;
  client: MCPClient;
  tools: RegisteredTool[];
  snapshot: MCPServerSnapshot;
  stop(): Promise<void>;
};

export async function loadMcpServers(input: {
  servers: Record<string, MCPServerConfig>;
}): Promise<LoadedMCPServer[]> {
  const loaded: LoadedMCPServer[] = [];

  for (const [name, config] of Object.entries(input.servers)) {
    if (config.enabled === false) {
      continue;
    }
    if ((config.transport ?? "stdio") !== "stdio") {
      loaded.push(unavailableServer(name, config, "Only stdio MCP transport is implemented in this slice."));
      continue;
    }
    if (typeof config.command !== "string" || config.command.trim().length === 0) {
      loaded.push(unavailableServer(name, config, "MCP stdio server requires a command."));
      continue;
    }

    const client = new MCPClient({
      name,
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
      timeoutMs: config.timeoutMs
    });

    try {
      await client.start();
      const allTools = await client.listTools();
      const filteredTools = filterTools(allTools, config);
      const resources = config.exposeResources === true && client.capabilities.resources !== undefined
        ? await client.listResources().catch(() => [])
        : [];
      const prompts = config.exposePrompts === true && client.capabilities.prompts !== undefined
        ? await client.listPrompts().catch(() => [])
        : [];
      const tools = [
        ...filteredTools.map((tool) => createMcpTool(name, config, client, tool)),
        ...(resources.length === 0 ? [] : createResourceTools(name, config, client, resources)),
        ...(prompts.length === 0 ? [] : createPromptTools(name, config, client, prompts))
      ];

      loaded.push({
        name,
        client,
        tools,
        snapshot: {
          name,
          transport: config.transport ?? "stdio",
          toolCount: filteredTools.length,
          resourceCount: resources.length,
          promptCount: prompts.length,
          tools: tools.map((tool) => tool.name),
          available: true
        },
        stop: () => client.stop()
      });
    } catch (error) {
      await client.stop().catch(() => undefined);
      loaded.push(unavailableServer(name, config, error instanceof Error ? error.message : String(error)));
    }
  }

  return loaded;
}

function unavailableServer(name: string, config: MCPServerConfig, error: string): LoadedMCPServer {
  return {
    name,
    client: {
      stop: async () => undefined
    } as unknown as MCPClient,
    tools: [],
    snapshot: {
      name,
      transport: config.transport ?? "stdio",
      toolCount: 0,
      resourceCount: 0,
      promptCount: 0,
      tools: [],
      available: false,
      error
    },
    stop: async () => undefined
  };
}

function createMcpTool(
  serverName: string,
  config: MCPServerConfig,
  client: MCPClient,
  tool: MCPToolDescriptor
): RegisteredTool {
  const toolName = prefixTool(serverName, config, tool.name);
  return {
    name: toolName,
    description: tool.description ?? `Call MCP tool ${tool.name} from ${serverName}.`,
    inputSchema: tool.inputSchema ?? {
      type: "object",
      additionalProperties: true
    },
    riskClass: "external-side-effect",
    toolsets: ["mcp"],
    progressLabel: `calling MCP ${serverName}`,
    maxResultSizeChars: 12_000,
    isAvailable: () => true,
    run: async (input: Record<string, unknown>) => {
      const result = await client.callTool(tool.name, input);
      return normalizeMcpResult(result);
    }
  };
}

function createResourceTools(
  serverName: string,
  config: MCPServerConfig,
  client: MCPClient,
  resources: MCPResourceDescriptor[]
): RegisteredTool[] {
  return [
    {
      name: prefixTool(serverName, config, "resource.list"),
      description: `List MCP resources exposed by ${serverName}.`,
      inputSchema: {
        type: "object",
        properties: {}
      },
      riskClass: "read-only-local",
      toolsets: ["mcp"],
      progressLabel: `listing MCP resources`,
      maxResultSizeChars: 12_000,
      isAvailable: () => true,
      run: async () => ({
        ok: true,
        content: resources.length === 0
          ? "No MCP resources available."
          : resources.map((resource) => `${resource.name ?? resource.uri}\t${resource.uri}\t${resource.mimeType ?? "unknown"}`).join("\n"),
        metadata: {
          resources
        }
      })
    },
    {
      name: prefixTool(serverName, config, "resource.read"),
      description: `Read an MCP resource from ${serverName} by URI.`,
      inputSchema: {
        type: "object",
        properties: {
          uri: { type: "string" }
        },
        required: ["uri"]
      },
      riskClass: "external-side-effect",
      toolsets: ["mcp"],
      progressLabel: `reading MCP resource`,
      maxResultSizeChars: 12_000,
      isAvailable: () => true,
      run: async (input: { uri?: string }) => {
        if (typeof input.uri !== "string" || input.uri.trim().length === 0) {
          return {
            ok: false,
            content: "resource.read requires uri"
          };
        }
        const result = await client.readResource(input.uri);
        return normalizeMcpResult(result);
      }
    }
  ];
}

function createPromptTools(
  serverName: string,
  config: MCPServerConfig,
  client: MCPClient,
  prompts: MCPPromptDescriptor[]
): RegisteredTool[] {
  return [
    {
      name: prefixTool(serverName, config, "prompt.list"),
      description: `List MCP prompts exposed by ${serverName}.`,
      inputSchema: {
        type: "object",
        properties: {}
      },
      riskClass: "read-only-local",
      toolsets: ["mcp"],
      progressLabel: `listing MCP prompts`,
      maxResultSizeChars: 12_000,
      isAvailable: () => true,
      run: async () => ({
        ok: true,
        content: prompts.length === 0
          ? "No MCP prompts available."
          : prompts.map((prompt) => `${prompt.name}\t${prompt.description ?? ""}`).join("\n"),
        metadata: {
          prompts
        }
      })
    },
    {
      name: prefixTool(serverName, config, "prompt.get"),
      description: `Get an MCP prompt from ${serverName} by name.`,
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          arguments: {
            type: "object",
            additionalProperties: true
          }
        },
        required: ["name"]
      },
      riskClass: "external-side-effect",
      toolsets: ["mcp"],
      progressLabel: `getting MCP prompt`,
      maxResultSizeChars: 12_000,
      isAvailable: () => true,
      run: async (input: { name?: string; arguments?: Record<string, unknown> }) => {
        if (typeof input.name !== "string" || input.name.trim().length === 0) {
          return {
            ok: false,
            content: "prompt.get requires name"
          };
        }
        const result = await client.getPrompt(input.name, input.arguments ?? {});
        return normalizeMcpResult(result);
      }
    }
  ];
}

function prefixTool(serverName: string, config: MCPServerConfig, toolName: string): string {
  if (config.toolPrefix === false) {
    return toolName;
  }
  if (typeof config.toolPrefix === "string" && config.toolPrefix.trim().length > 0) {
    return `${config.toolPrefix.trim()}.${toolName}`;
  }
  return `mcp.${serverName}.${toolName}`;
}

function filterTools(tools: MCPToolDescriptor[], config: MCPServerConfig): MCPToolDescriptor[] {
  const include = new Set(config.includeTools ?? []);
  const exclude = new Set(config.excludeTools ?? []);
  return tools.filter((tool) => {
    if (include.size > 0 && !include.has(tool.name)) {
      return false;
    }
    if (exclude.has(tool.name)) {
      return false;
    }
    return true;
  });
}

function normalizeMcpResult(result: unknown): ToolResult {
  if (typeof result === "string") {
    return {
      ok: true,
      content: result
    };
  }

  if (typeof result !== "object" || result === null) {
    return {
      ok: true,
      content: JSON.stringify(result, null, 2)
    };
  }

  const record = result as Record<string, unknown>;
  const content = Array.isArray(record.content)
    ? record.content.map(renderContentPart).filter((part) => part.length > 0).join("\n\n")
    : undefined;
  const isError = record.isError === true;

  return {
    ok: !isError,
    content: content?.length
      ? content
      : JSON.stringify(result, null, 2),
    metadata: record
  };
}

function renderContentPart(part: unknown): string {
  if (typeof part === "string") {
    return part;
  }
  if (typeof part !== "object" || part === null) {
    return JSON.stringify(part, null, 2);
  }
  const record = part as Record<string, unknown>;
  if (record.type === "text" && typeof record.text === "string") {
    return record.text;
  }
  if (record.type === "resource" && typeof record.uri === "string") {
    return `Resource: ${record.uri}`;
  }
  if (record.type === "image" && typeof record.mimeType === "string") {
    return `Image content (${record.mimeType})`;
  }
  return JSON.stringify(part, null, 2);
}

import { describe, expect, it } from "vitest";
import { MCPClient } from "./mcp-client.js";

describe("MCPClient stdio lifecycle", () => {
  it("rejects startup when a stdio child exits before initialize can complete", async () => {
    const client = new MCPClient({
      name: "exits-immediately",
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      connectTimeoutMs: 1_000,
      timeoutMs: 1_000
    });

    await expect(client.start()).rejects.toThrow(/MCP server exits-immediately (?:stdin write failed|connection is closed|exited|closed)/u);
    await expect(client.stop()).resolves.toBeUndefined();
  });

  it("rejects requests after a stdio child closes", async () => {
    const script = [
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => {",
      "  for (const line of chunk.trim().split(/\\n+/u)) {",
      "    if (line.length === 0) continue;",
      "    const message = JSON.parse(line);",
      "    if (message.method === 'initialize') {",
      "      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { capabilities: { tools: {} } } }) + '\\n');",
      "    }",
      "    if (message.method === 'notifications/initialized') {",
      "      setTimeout(() => process.exit(0), 10);",
      "    }",
      "  }",
      "});",
      "process.stdin.resume();"
    ].join("\n");
    const client = new MCPClient({
      name: "closes-after-initialize",
      command: process.execPath,
      args: ["-e", script],
      connectTimeoutMs: 1_000,
      timeoutMs: 1_000
    });

    await client.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(client.listTools()).rejects.toThrow(/MCP server closes-after-initialize (?:stdin write failed|connection is closed|exited|closed)/u);
    await expect(client.stop()).resolves.toBeUndefined();
  });
});

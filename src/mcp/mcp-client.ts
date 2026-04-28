import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type MCPServerTransport = "stdio" | "http";

type JSONRPCRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
};

type JSONRPCResponse = {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  method?: string;
  params?: unknown;
};

export type MCPToolDescriptor = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type MCPResourceDescriptor = {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
};

export type MCPPromptDescriptor = {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
};

export type MCPServerCapabilities = {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
};

export class MCPClient {
  readonly #name: string;
  readonly #command: string;
  readonly #args: string[];
  readonly #cwd: string | undefined;
  readonly #env: Record<string, string> | undefined;
  readonly #timeoutMs: number;
  #child: ChildProcessWithoutNullStreams | undefined;
  #buffer = "";
  #nextId = 1;
  #started = false;
  #stderr = "";
  readonly #pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }>();

  capabilities: MCPServerCapabilities = {};

  constructor(options: {
    name: string;
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  }) {
    this.#name = options.name;
    this.#command = options.command;
    this.#args = options.args ?? [];
    this.#cwd = options.cwd;
    this.#env = options.env;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async start(): Promise<void> {
    if (this.#started) {
      return;
    }

    this.#child = spawn(this.#command, this.#args, {
      cwd: this.#cwd,
      env: this.#env === undefined
        ? process.env
        : {
            ...process.env,
            ...this.#env
          },
      stdio: "pipe"
    });
    this.#child.stdout.setEncoding("utf8");
    this.#child.stderr.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk: string) => {
      this.#buffer += chunk;
      this.#pump();
    });
    this.#child.stderr.on("data", (chunk: string) => {
      this.#stderr += chunk;
    });
    this.#child.on("exit", (code, signal) => {
      const error = new Error(`MCP server ${this.#name} exited (${code ?? "null"}${signal === null ? "" : `, ${signal}`})`);
      for (const pending of this.#pending.values()) {
        pending.reject(error);
      }
      this.#pending.clear();
    });

    const initialize = await this.#request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "EstaCoda",
        version: "0.0.0"
      }
    }) as {
      capabilities?: MCPServerCapabilities;
    };
    this.capabilities = initialize.capabilities ?? {};
    await this.#notify("notifications/initialized", {});
    this.#started = true;
  }

  async listTools(): Promise<MCPToolDescriptor[]> {
    const result = await this.#request("tools/list", {}) as { tools?: MCPToolDescriptor[] };
    return result.tools ?? [];
  }

  async callTool(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    return await this.#request("tools/call", {
      name,
      arguments: arguments_
    });
  }

  async listResources(): Promise<MCPResourceDescriptor[]> {
    const result = await this.#request("resources/list", {}) as { resources?: MCPResourceDescriptor[] };
    return result.resources ?? [];
  }

  async readResource(uri: string): Promise<unknown> {
    return await this.#request("resources/read", { uri });
  }

  async listPrompts(): Promise<MCPPromptDescriptor[]> {
    const result = await this.#request("prompts/list", {}) as { prompts?: MCPPromptDescriptor[] };
    return result.prompts ?? [];
  }

  async getPrompt(name: string, args: Record<string, unknown>): Promise<unknown> {
    return await this.#request("prompts/get", {
      name,
      arguments: args
    });
  }

  async stop(): Promise<void> {
    const child = this.#child;
    this.#child = undefined;
    this.#started = false;
    if (child === undefined || child.killed) {
      return;
    }
    child.kill();
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      setTimeout(() => resolve(), 500);
    });
  }

  async #notify(method: string, params?: unknown): Promise<void> {
    const child = this.#child;
    if (child === undefined) {
      throw new Error(`MCP server ${this.#name} is not running`);
    }
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params
    });
    child.stdin.write(frameMessage(payload), "utf8");
  }

  async #request(method: string, params?: unknown): Promise<unknown> {
    const child = this.#child;
    if (child === undefined) {
      throw new Error(`MCP server ${this.#name} is not running`);
    }

    const id = this.#nextId++;
    const payload: JSONRPCRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };

    const response = await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`MCP request timed out: ${this.#name} ${method}`));
      }, this.#timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
      child.stdin.write(frameMessage(JSON.stringify(payload)), "utf8");
    });

    return response;
  }

  #pump(): void {
    while (true) {
      const boundary = this.#buffer.indexOf("\r\n\r\n");
      if (boundary === -1) {
        return;
      }
      const header = this.#buffer.slice(0, boundary);
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/iu);
      if (lengthMatch === null) {
        this.#buffer = "";
        throw new Error(`Invalid MCP frame from ${this.#name}`);
      }
      const length = Number(lengthMatch[1]);
      const start = boundary + 4;
      if (this.#buffer.length < start + length) {
        return;
      }
      const body = this.#buffer.slice(start, start + length);
      this.#buffer = this.#buffer.slice(start + length);
      this.#handleMessage(JSON.parse(body) as JSONRPCResponse);
    }
  }

  #handleMessage(message: JSONRPCResponse): void {
    if (typeof message.id !== "number") {
      return;
    }
    const pending = this.#pending.get(message.id);
    if (pending === undefined) {
      return;
    }
    this.#pending.delete(message.id);
    if (message.error !== undefined) {
      pending.reject(new Error(`MCP error from ${this.#name}: ${message.error.message}${this.#stderr.length === 0 ? "" : `\n${this.#stderr.trim()}`}`));
      return;
    }
    pending.resolve(message.result);
  }
}

function frameMessage(body: string): string {
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

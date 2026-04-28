import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import type { SessionDB } from "../contracts/session.js";
import type { SessionMessage } from "../contracts/session.js";
import type { Runtime, RuntimeOptions } from "../runtime/create-runtime.js";
import { createRuntime } from "../runtime/create-runtime.js";
import { SQLiteSessionDB } from "../session/sqlite-session-db.js";
import { kemetBlueTheme } from "../theme/kemet-blue.js";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcSuccess = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
};

type JsonRpcError = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

type AcpServerOptions = {
  workspaceRoot: string;
  homeDir?: string;
  userConfigPath?: string;
  projectConfigPath?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  sessionDb?: SessionDB;
  runtimeFactory?: (options: {
    workspaceRoot: string;
    sessionId: string;
    homeDir: string;
    userConfigPath?: string;
    projectConfigPath?: string;
    sessionDb: SessionDB;
  }) => Promise<Runtime>;
};

type AcpSession = {
  acpSessionId: string;
  estacodaSessionId: string;
  workspaceRoot: string;
  runtime: Runtime;
  messages: SessionMessage[];
  activeTurn?: AbortController;
};

type PromptStopReason = "end_turn" | "cancelled" | "error";

const ACP_PROTOCOL_VERSION = "0.1";

export async function runAcpServer(options: AcpServerOptions): Promise<void> {
  const server = new AcpServer(options);
  await server.run();
}

export class AcpServer {
  readonly #workspaceRoot: string;
  readonly #homeDir: string;
  readonly #userConfigPath: string | undefined;
  readonly #projectConfigPath: string | undefined;
  readonly #input: NodeJS.ReadableStream;
  readonly #output: NodeJS.WritableStream;
  readonly #sessionDb: SessionDB;
  readonly #closeSessionDb: boolean;
  readonly #runtimeFactory: AcpServerOptions["runtimeFactory"];
  readonly #sessions = new Map<string, AcpSession>();
  #buffer = "";
  #closed = false;

  constructor(options: AcpServerOptions) {
    this.#workspaceRoot = options.workspaceRoot;
    this.#homeDir = options.homeDir ?? join(homedir(), ".estacoda");
    this.#userConfigPath = options.userConfigPath;
    this.#projectConfigPath = options.projectConfigPath;
    this.#input = options.input ?? process.stdin;
    this.#output = options.output ?? process.stdout;
    this.#runtimeFactory = options.runtimeFactory;
    if (options.sessionDb !== undefined) {
      this.#sessionDb = options.sessionDb;
      this.#closeSessionDb = false;
    } else {
      this.#sessionDb = new SQLiteSessionDB({
        path: join(this.#homeDir, "sessions.sqlite")
      });
      this.#closeSessionDb = true;
    }
  }

  async run(): Promise<void> {
    await mkdir(this.#homeDir, { recursive: true });
    this.#input.setEncoding?.("utf8");

    await new Promise<void>((resolve) => {
      const onData = (chunk: string | Buffer) => {
        this.#buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        void this.#pump();
      };
      const onEnd = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        this.#input.off("data", onData);
        this.#input.off("end", onEnd);
        this.#input.off("error", onError);
      };

      this.#input.on("data", onData);
      this.#input.once("end", onEnd);
      this.#input.once("error", onError);
    });

    await this.close();
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await Promise.all([...this.#sessions.values()].map(async (session) => {
      session.activeTurn?.abort("server closing");
      await session.runtime.dispose().catch(() => undefined);
    }));
    this.#sessions.clear();
    if (this.#closeSessionDb && this.#sessionDb instanceof SQLiteSessionDB) {
      this.#sessionDb.close();
    }
  }

  async #pump(): Promise<void> {
    while (true) {
      const newline = this.#buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      const line = this.#buffer.slice(0, newline).replace(/\r$/u, "").trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line.length === 0) {
        continue;
      }

      let request: JsonRpcRequest;
      try {
        request = JSON.parse(line) as JsonRpcRequest;
      } catch {
        this.#write({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: "Parse error"
          }
        });
        continue;
      }

      await this.#handle(request);
    }
  }

  async #handle(request: JsonRpcRequest): Promise<void> {
    const id = request.id ?? null;

    try {
      switch (request.method) {
        case "initialize":
          this.#write({
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: ACP_PROTOCOL_VERSION,
              agentCapabilities: {
                promptCapabilities: {
                  text: true
                },
                sessionCapabilities: {
                  newSession: true,
                  loadSession: true,
                  listSessions: true,
                  cancelPrompt: true,
                  cwd: true
                }
              },
              authMethods: []
            }
          });
          return;
        case "authenticate":
          this.#write({
            jsonrpc: "2.0",
            id,
            result: {
              authenticated: true
            }
          });
          return;
        case "session/new":
          this.#write({
            jsonrpc: "2.0",
            id,
            result: await this.#newSession(request.params)
          });
          return;
        case "session/load":
          this.#write({
            jsonrpc: "2.0",
            id,
            result: await this.#loadSession(request.params)
          });
          return;
        case "session/list":
          this.#write({
            jsonrpc: "2.0",
            id,
            result: await this.#listSessions()
          });
          return;
        case "session/prompt":
          this.#write({
            jsonrpc: "2.0",
            id,
            result: await this.#promptSession(request.params)
          });
          return;
        case "session/cancel":
          await this.#cancelSession(request.params);
          return;
        default:
          this.#write({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`
            }
          });
      }
    } catch (error) {
      this.#write({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  async #newSession(params: unknown): Promise<{ sessionId: string }> {
    const parsed = asObject(params);
    const workspaceRoot = typeof parsed.cwd === "string" && parsed.cwd.length > 0
      ? parsed.cwd
      : this.#workspaceRoot;
    const estacodaSessionId = randomUUID();
    const runtime = await this.#buildRuntime({
      workspaceRoot,
      sessionId: estacodaSessionId
    });
    const session: AcpSession = {
      acpSessionId: randomUUID(),
      estacodaSessionId: runtime.sessionId,
      workspaceRoot,
      runtime,
      messages: []
    };
    this.#sessions.set(session.acpSessionId, session);
    this.#emitSessionInfo(session);
    return { sessionId: session.acpSessionId };
  }

  async #loadSession(params: unknown): Promise<{ sessionId: string }> {
    const parsed = asObject(params);
    const requested = expectString(parsed.sessionId, "sessionId");
    const existing = this.#sessions.get(requested);
    if (existing !== undefined) {
      await this.#replayMessages(existing);
      this.#emitSessionInfo(existing);
      return { sessionId: existing.acpSessionId };
    }

    const record = await this.#sessionDb.getSession(requested);
    if (record === undefined) {
      throw new Error(`Unknown session: ${requested}`);
    }

    const workspaceRoot = typeof record.metadata?.workspaceRoot === "string"
      ? record.metadata.workspaceRoot
      : this.#workspaceRoot;
    const runtime = await this.#buildRuntime({
      workspaceRoot,
      sessionId: record.id
    });
    const messages = await this.#sessionDb.listMessages(record.id);
    const session: AcpSession = {
      acpSessionId: requested,
      estacodaSessionId: record.id,
      workspaceRoot,
      runtime,
      messages
    };
    this.#sessions.set(session.acpSessionId, session);
    this.#emitSessionInfo(session);
    await this.#replayMessages(session);
    return { sessionId: session.acpSessionId };
  }

  async #listSessions(): Promise<{
    sessions: Array<{ sessionId: string; title?: string; updatedAt: string }>;
  }> {
    const sessions = await this.#sessionDb.listSessions();
    return {
      sessions: sessions.map((session) => ({
        sessionId: session.id,
        title: session.title,
        updatedAt: session.updatedAt
      }))
    };
  }

  async #promptSession(params: unknown): Promise<{ stopReason: PromptStopReason }> {
    const parsed = asObject(params);
    const acpSessionId = expectString(parsed.sessionId, "sessionId");
    const prompt = extractPromptText(parsed.prompt ?? parsed.input ?? parsed.messages);
    const session = this.#sessions.get(acpSessionId);
    if (session === undefined) {
      throw new Error(`Unknown session: ${acpSessionId}`);
    }

    session.activeTurn?.abort("replaced");
    const controller = new AbortController();
    session.activeTurn = controller;
    let streamedAgentText = false;

    try {
      const response = await session.runtime.handle({
        text: prompt,
        channel: "web",
        workspaceRoot: session.workspaceRoot,
        signal: controller.signal,
        onEvent: async (event) => {
          switch (event.kind) {
            case "agent-start":
              this.#notify({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId: acpSessionId,
                  update: {
                    sessionUpdate: "thought_message_chunk",
                    content: { type: "text", text: `thinking: ${event.input}` }
                  }
                }
              });
              break;
            case "intent":
              this.#notify({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId: acpSessionId,
                  update: {
                    sessionUpdate: "plan_update",
                    entries: event.labels.map((label) => ({
                      label,
                      state: "selected"
                    }))
                  }
                }
              });
              break;
            case "skill":
              this.#notify({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId: acpSessionId,
                  update: {
                    sessionUpdate: "thought_message_chunk",
                    content: { type: "text", text: `skill selected: ${event.name}` }
                  }
                }
              });
              break;
            case "tool-start":
              this.#notify({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId: acpSessionId,
                  update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: event.stepId ?? event.tool,
                    title: event.tool,
                    kind: classifyToolKind(event.tool),
                    status: "in_progress"
                  }
                }
              });
              break;
            case "tool-result":
              this.#notify({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId: acpSessionId,
                  update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: event.tool,
                    title: event.tool,
                    kind: classifyToolKind(event.tool),
                    status: event.decision === "ask"
                      ? "blocked"
                      : event.ok === false
                        ? "failed"
                        : "completed",
                    content: summarizeToolResult(event)
                  }
                }
              });
              break;
            case "provider-token":
              streamedAgentText = true;
              this.#notify({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId: acpSessionId,
                  update: {
                    sessionUpdate: "agent_message_chunk",
                    content: { type: "text", text: event.text }
                  }
                }
              });
              break;
            case "provider-attempt":
              this.#notify({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId: acpSessionId,
                  update: {
                    sessionUpdate: "session_info_update",
                    model: `${event.provider}/${event.model}`
                  }
                }
              });
              break;
            case "agent-cancelled":
              this.#notify({
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId: acpSessionId,
                  update: {
                    sessionUpdate: "thought_message_chunk",
                    content: { type: "text", text: `cancelled: ${event.reason}` }
                  }
                }
              });
              break;
            case "agent-final":
              if (streamedAgentText === false) {
                this.#notify({
                  jsonrpc: "2.0",
                  method: "session/update",
                  params: {
                    sessionId: acpSessionId,
                    update: {
                      sessionUpdate: "agent_message_chunk",
                      content: { type: "text", text: event.text }
                    }
                  }
                });
              }
              break;
          }
        }
      });

      session.messages = await this.#sessionDb.listMessages(session.estacodaSessionId);
      const usage = response.providerExecution?.response?.usage;
      if (usage !== undefined) {
        this.#notify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: acpSessionId,
            update: {
              sessionUpdate: "usage_update",
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens
            }
          }
        });
      }

      return {
        stopReason: response.securityDecision === "deny" || response.securityDecision === "ask"
          ? "end_turn"
          : "end_turn"
      };
    } catch (error) {
      if (controller.signal.aborted) {
        return { stopReason: "cancelled" };
      }
      throw error;
    } finally {
      if (session.activeTurn === controller) {
        session.activeTurn = undefined;
      }
    }
  }

  async #cancelSession(params: unknown): Promise<void> {
    const parsed = asObject(params);
    const acpSessionId = expectString(parsed.sessionId, "sessionId");
    this.#sessions.get(acpSessionId)?.activeTurn?.abort("acp session cancelled");
  }

  async #buildRuntime(options: {
    workspaceRoot: string;
    sessionId: string;
  }): Promise<Runtime> {
    if (this.#runtimeFactory !== undefined) {
      return await this.#runtimeFactory({
        workspaceRoot: options.workspaceRoot,
        sessionId: options.sessionId,
        homeDir: this.#homeDir,
        userConfigPath: this.#userConfigPath,
        projectConfigPath: this.#projectConfigPath,
        sessionDb: this.#sessionDb
      });
    }

    const config = await loadRuntimeConfig({
      workspaceRoot: options.workspaceRoot,
      homeDir: this.#homeDir,
      userConfigPath: this.#userConfigPath,
      projectConfigPath: this.#projectConfigPath
    });

    const runtimeOptions: RuntimeOptions = {
      theme: kemetBlueTheme,
      model: config.model,
      workspaceRoot: options.workspaceRoot,
      sessionId: options.sessionId,
      sessionDb: this.#sessionDb,
      externalSkillRoots: config.skills.externalDirs,
      skillAutonomy: config.skills.autonomy,
      skillConfig: config.skills.config,
      providerRegistry: config.providerRegistry,
      credentialPools: config.credentialPools,
      auxiliaryProviders: config.auxiliaryProviders,
      mcpServers: config.mcp.servers,
      browser: config.browser,
      telegramReady: config.channels.telegram.ready,
      enableWebNetwork: config.web.enableNetwork,
      webMaxContentChars: config.web.maxContentChars,
      homeDir: this.#homeDir,
      userConfigPath: this.#userConfigPath,
      projectConfigPath: this.#projectConfigPath
    };

    return await createRuntime(runtimeOptions);
  }

  async #replayMessages(session: AcpSession): Promise<void> {
    for (const message of session.messages) {
      this.#notify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: session.acpSessionId,
          update: replayUpdateForMessage(message)
        }
      });
    }
  }

  #emitSessionInfo(session: AcpSession): void {
    this.#notify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: session.acpSessionId,
        update: {
          sessionUpdate: "session_info_update",
          sessionId: session.acpSessionId,
          cwd: session.workspaceRoot,
          estacodaSessionId: session.estacodaSessionId
        }
      }
    });
  }

  #notify(message: JsonRpcNotification): void {
    this.#write(message);
  }

  #write(message: JsonRpcSuccess | JsonRpcError | JsonRpcNotification): void {
    this.#output.write(`${JSON.stringify(message)}\n`, "utf8");
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function expectString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new Error(`Missing or invalid ${field}`);
}

function extractPromptText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractPromptText).filter((part) => part.length > 0).join("\n");
  }

  if (typeof value !== "object" || value === null) {
    return "";
  }

  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  if (Array.isArray(record.content)) {
    return record.content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (typeof item === "object" && item !== null && typeof (item as { text?: unknown }).text === "string") {
          return String((item as { text: string }).text);
        }
        return "";
      })
      .filter((part) => part.length > 0)
      .join("\n");
  }
  if (Array.isArray(record.messages)) {
    return extractPromptText(record.messages);
  }

  return "";
}

function replayUpdateForMessage(message: SessionMessage): Record<string, unknown> {
  if (message.role === "user") {
    return {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: message.content }
    };
  }

  return {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: message.content }
  };
}

function classifyToolKind(toolName: string): string {
  if (toolName.startsWith("terminal.") || toolName.startsWith("process.")) {
    return "shell";
  }
  if (toolName.startsWith("file.") || toolName.startsWith("workspace.") || toolName.startsWith("mcp.")) {
    return "read";
  }
  return "task";
}

function summarizeToolResult(event: {
  decision?: string;
  riskClass?: string;
  ok?: boolean;
  chars?: number;
  sentChars?: number;
  truncated?: boolean;
}): string {
  return [
    event.decision === undefined ? undefined : `decision=${event.decision}`,
    event.riskClass === undefined ? undefined : `risk=${event.riskClass}`,
    event.ok === undefined ? undefined : `ok=${event.ok ? "yes" : "no"}`,
    event.chars === undefined ? undefined : `chars=${event.chars}`,
    event.sentChars === undefined ? undefined : `sent=${event.sentChars}`,
    event.truncated === true ? "truncated=yes" : undefined
  ].filter((part): part is string => typeof part === "string").join(" ");
}

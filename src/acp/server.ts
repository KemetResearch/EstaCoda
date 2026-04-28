import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { capabilityFirstDefaults, type SecurityDecision, type SecurityPolicy, type SecurityRequest } from "../contracts/security.js";
import type { SessionDB } from "../contracts/session.js";
import type { SessionMessage } from "../contracts/session.js";
import type { Runtime, RuntimeOptions } from "../runtime/create-runtime.js";
import { createRuntime } from "../runtime/create-runtime.js";
import { SQLiteSessionDB } from "../session/sqlite-session-db.js";
import { kemetBlueTheme } from "../theme/kemet-blue.js";
import type { WorkspaceFsAdapter } from "../tools/workspace-tools.js";

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
    securityPolicy: SecurityPolicy;
  }) => Promise<Runtime>;
  permissionTimeoutMs?: number;
};

type SessionGrants = {
  allowOnce: Set<string>;
  allowAlways: Set<string>;
  rejectAlways: Set<string>;
};

type AcpSession = {
  acpSessionId: string;
  estacodaSessionId: string;
  workspaceRoot: string;
  runtime: Runtime;
  messages: SessionMessage[];
  grants: SessionGrants;
  activeTurn?: AbortController;
};

type RequestPermissionOutcome =
  | { outcome: "selected"; optionId: string; source?: "client" | "default-deny" }
  | { outcome: "cancelled" };

type PromptStopReason = "end_turn" | "cancelled" | "error";

const ACP_PROTOCOL_VERSION = 1;

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
  readonly #permissionTimeoutMs: number;
  readonly #pendingOutgoing = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }>();
  readonly #pendingPermissionBySession = new Map<string, number>();
  #nextOutgoingId = 1_000;
  readonly #sessions = new Map<string, AcpSession>();
  #clientFsReadText = false;
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
    this.#permissionTimeoutMs = options.permissionTimeoutMs ?? 30_000;
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

      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
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

      if (typeof message.method === "string") {
        await this.#handle(message as JsonRpcRequest);
        continue;
      }

      this.#handleOutgoingResponse(message);
    }
  }

  async #handle(request: JsonRpcRequest): Promise<void> {
    const id = request.id ?? null;

    try {
      switch (request.method) {
        case "initialize":
          {
            const parsed = asObject(request.params);
            const clientCapabilities = asObject(parsed.clientCapabilities);
            const fsCapabilities = asObject(clientCapabilities.fs);
            this.#clientFsReadText = fsCapabilities.readTextFile === true;
          }
          this.#write({
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: ACP_PROTOCOL_VERSION,
              agentCapabilities: {
                loadSession: true,
                promptCapabilities: {
                  image: false,
                  audio: false,
                  embeddedContext: false
                },
                sessionCapabilities: {
                  newSession: true,
                  loadSession: true,
                  listSessions: true,
                  cancelPrompt: true,
                  cwd: true
                }
              },
              agentInfo: {
                name: "estacoda",
                version: "0.0.0"
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
    const acpSessionId = randomUUID();
    const estacodaSessionId = randomUUID();
    const grants = createSessionGrants();
    const runtime = await this.#buildRuntime({
      acpSessionId,
      workspaceRoot,
      sessionId: estacodaSessionId,
      grants
    });
    const session: AcpSession = {
      acpSessionId,
      estacodaSessionId: runtime.sessionId,
      workspaceRoot,
      runtime,
      messages: [],
      grants
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
    const grants = createSessionGrants();
    const runtime = await this.#buildRuntime({
      acpSessionId: requested,
      workspaceRoot,
      sessionId: record.id,
      grants
    });
    const messages = await this.#sessionDb.listMessages(record.id);
    const session: AcpSession = {
      acpSessionId: requested,
      estacodaSessionId: record.id,
      workspaceRoot,
      runtime,
      messages,
      grants
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
    const prompt = extractPromptText(parsed.prompt ?? parsed.input ?? parsed.content ?? parsed.messages);
    const session = this.#sessions.get(acpSessionId);
    if (session === undefined) {
      throw new Error(`Unknown session: ${acpSessionId}`);
    }

    session.activeTurn?.abort("replaced");
    const controller = new AbortController();
    session.activeTurn = controller;
    const runtimeText = await this.#buildRuntimeText(session, prompt);
    let streamedAgentText = false;

    try {
      let response = await session.runtime.handle({
        text: runtimeText,
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

      while (true) {
        const gated = response.toolExecutions.find((execution) => execution.decision === "ask");
        if (gated === undefined) {
          break;
        }

        const permissionOutcome = await this.#requestPermission(session, gated);
        if (permissionOutcome.outcome !== "selected") {
          this.#notify({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: acpSessionId,
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId: gated.targetKey ?? gated.tool.name,
                title: gated.targetSummary ?? gated.tool.name,
                kind: classifyToolKind(gated.tool.name),
                status: "completed",
                content: [{ type: "content", content: { type: "text", text: "Permission denied or cancelled." } }]
              }
            }
          });
          return { stopReason: permissionOutcome.outcome === "cancelled" ? "cancelled" : "end_turn" };
        }

        if (permissionOutcome.optionId.startsWith("reject")) {
          this.#notify({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: acpSessionId,
              update: {
                sessionUpdate: "thought_message_chunk",
                content: {
                  type: "text",
                  text: permissionOutcome.source === "default-deny"
                    ? "Permission request timed out or failed. Denied by default."
                    : "Permission denied."
                }
              }
            }
          });
          return { stopReason: permissionOutcome.source === "default-deny" ? "end_turn" : "cancelled" };
        }

        applyPermissionSelection(session, gated.targetKey, permissionOutcome.optionId);
        this.#notify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: acpSessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: gated.targetKey ?? gated.tool.name,
              title: gated.targetSummary ?? gated.tool.name,
              kind: classifyToolKind(gated.tool.name),
              status: "in_progress",
              content: [{ type: "content", content: { type: "text", text: "Permission granted. Resuming action." } }]
            }
          }
        });
        response = await session.runtime.handle({
          text: runtimeText,
          channel: "web",
          workspaceRoot: session.workspaceRoot,
          signal: controller.signal,
          onEvent: async (event) => {
            await this.#emitRuntimeEvent(acpSessionId, event);
          }
        });
      }

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
        stopReason: "end_turn"
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
    const pendingPermission = this.#pendingPermissionBySession.get(acpSessionId);
    if (pendingPermission !== undefined) {
      this.#pendingOutgoing.get(pendingPermission)?.resolve({ outcome: "cancelled" });
      this.#pendingOutgoing.delete(pendingPermission);
      this.#pendingPermissionBySession.delete(acpSessionId);
    }
  }

  async #buildRuntime(options: {
    acpSessionId: string;
    workspaceRoot: string;
    sessionId: string;
    grants: SessionGrants;
  }): Promise<Runtime> {
    if (this.#runtimeFactory !== undefined) {
      return await this.#runtimeFactory({
        workspaceRoot: options.workspaceRoot,
        sessionId: options.sessionId,
        homeDir: this.#homeDir,
        userConfigPath: this.#userConfigPath,
        projectConfigPath: this.#projectConfigPath,
        sessionDb: this.#sessionDb,
        securityPolicy: createAcpSecurityPolicy(options.grants, {
          allowEditorRead: this.#clientFsReadText
        })
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
      securityPolicy: createAcpSecurityPolicy(options.grants, {
        allowEditorRead: this.#clientFsReadText
      }),
      workspaceFsAdapter: this.#clientFsReadText === true
        ? createAcpWorkspaceFsAdapter({
            readTextFile: async (input) => await this.#readEditorTextFile({
              sessionId: options.acpSessionId,
              ...input
            })
          })
        : undefined,
      homeDir: this.#homeDir,
      userConfigPath: this.#userConfigPath,
      projectConfigPath: this.#projectConfigPath
    };

    return await createRuntime(runtimeOptions);
  }

  async #buildRuntimeText(session: AcpSession, userText: string): Promise<string> {
    const editorFileContext = this.#clientFsReadText
      ? await this.#loadEditorFileContext(session.acpSessionId, session.workspaceRoot, userText)
      : [];

    return buildAcpRuntimePrompt({
      workspaceRoot: session.workspaceRoot,
      userText,
      editorFsReadAvailable: this.#clientFsReadText,
      editorFileContext
    });
  }

  async #loadEditorFileContext(
    acpSessionId: string,
    workspaceRoot: string,
    userText: string
  ): Promise<Array<{
    path: string;
    content: string;
  }>> {
    const references = extractWorkspaceFileReferences(userText, workspaceRoot);
    const contexts: Array<{ path: string; content: string }> = [];

    for (const reference of references) {
      try {
        const content = await this.#readEditorTextFile({
          sessionId: acpSessionId,
          path: reference.absolutePath
        });
        contexts.push({
          path: reference.relativePath,
          content: content.length > 12_000 ? `${content.slice(0, 12_000)}\n...[truncated]` : content
        });
      } catch {
        continue;
      }
    }

    return contexts;
  }

  async #requestPermission(session: AcpSession, gated: {
    tool: { name: string };
    riskClass: string;
    targetKey?: string;
    targetSummary?: string;
  }): Promise<RequestPermissionOutcome> {
    const toolCallId = gated.targetKey ?? gated.tool.name;
    const title = gated.targetSummary ?? gated.tool.name;
    const toolCall = {
      sessionUpdate: "tool_call_update",
      toolCallId,
      title,
      kind: classifyToolKind(gated.tool.name),
      status: "blocked",
      rawInput: {
        toolName: gated.tool.name,
        riskClass: gated.riskClass,
        targetKey: gated.targetKey,
        targetSummary: gated.targetSummary
      }
    };

    this.#notify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: session.acpSessionId,
        update: toolCall
      }
    });

    const outcome = await this.#callClient<RequestPermissionOutcome>("session/request_permission", {
      sessionId: session.acpSessionId,
      toolCall,
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" }
      ]
    }, this.#permissionTimeoutMs, session.acpSessionId).catch(() => ({
      outcome: "selected",
      optionId: "reject-once",
      source: "default-deny"
    } satisfies RequestPermissionOutcome));

    return outcome;
  }

  async #emitRuntimeEvent(acpSessionId: string, event: {
    kind: string;
    [key: string]: unknown;
  }): Promise<void> {
    switch (event.kind) {
      case "agent-start":
        this.#notify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: acpSessionId,
            update: {
              sessionUpdate: "thought_message_chunk",
              content: { type: "text", text: `thinking: ${String(event.input ?? "")}` }
            }
          }
        });
        return;
      case "intent":
        this.#notify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: acpSessionId,
            update: {
              sessionUpdate: "plan",
              entries: Array.isArray(event.labels)
                ? event.labels.map((label) => ({ label, status: "in_progress", priority: "medium" }))
                : []
            }
          }
        });
        return;
      case "skill":
        this.#notify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: acpSessionId,
            update: {
              sessionUpdate: "thought_message_chunk",
              content: { type: "text", text: `skill selected: ${String(event.name ?? "")}` }
            }
          }
        });
        return;
      case "tool-start":
        this.#notify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: acpSessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: String(event.stepId ?? event.tool ?? "tool"),
              title: String(event.tool ?? "tool"),
              kind: classifyToolKind(String(event.tool ?? "tool")),
              status: "in_progress"
            }
          }
        });
        return;
      case "tool-result":
        this.#notify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: acpSessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: String(event.tool ?? "tool"),
              title: String(event.tool ?? "tool"),
              kind: classifyToolKind(String(event.tool ?? "tool")),
              status: event.decision === "ask" ? "blocked" : event.ok === false ? "failed" : "completed",
              rawOutput: {
                decision: event.decision,
                ok: event.ok,
                riskClass: event.riskClass
              },
              content: summarizeToolContent(event)
            }
          }
        });
        return;
      case "provider-token":
        this.#notify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: acpSessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: String(event.text ?? "") }
            }
          }
        });
        return;
      case "provider-attempt":
        this.#notify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: acpSessionId,
            update: {
              sessionUpdate: "session_info_update",
              model: `${String(event.provider ?? "")}/${String(event.model ?? "")}`
            }
          }
        });
        return;
      case "agent-cancelled":
        this.#notify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: acpSessionId,
            update: {
              sessionUpdate: "thought_message_chunk",
              content: { type: "text", text: `cancelled: ${String(event.reason ?? "")}` }
            }
          }
        });
        return;
      case "agent-final":
        this.#notify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: acpSessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: String(event.text ?? "") }
            }
          }
        });
        return;
    }
  }

  async #readEditorTextFile(input: {
    sessionId: string;
    path: string;
    lineStart?: number;
    lineEnd?: number;
  }): Promise<string> {
    const params: Record<string, unknown> = {
      sessionId: input.sessionId,
      path: input.path
    };
    if (typeof input.lineStart === "number") {
      params.line = Math.max(1, input.lineStart);
    }
    if (typeof input.lineStart === "number" && typeof input.lineEnd === "number" && input.lineEnd >= input.lineStart) {
      params.limit = Math.max(1, input.lineEnd - input.lineStart + 1);
    }

    const result = await this.#callClient<unknown>("fs/read_text_file", params, 10_000);
    if (typeof result === "string") {
      return result;
    }
    const record = asObject(result);
    if (typeof record.content === "string") {
      return record.content;
    }
    if (Array.isArray(record.lines)) {
      return record.lines
        .map((line) => typeof line === "string" ? line : "")
        .join("\n");
    }
    throw new Error(`ACP client returned an unsupported fs/read_text_file payload for ${input.path}`);
  }

  async #callClient<T>(method: string, params: unknown, timeoutMs: number, sessionId?: string): Promise<T> {
    const id = this.#nextOutgoingId++;
    const response = await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingOutgoing.delete(id);
        if (sessionId !== undefined) {
          this.#pendingPermissionBySession.delete(sessionId);
        }
        reject(new Error(`ACP client request timed out: ${method}`));
      }, timeoutMs);

      this.#pendingOutgoing.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          if (sessionId !== undefined) {
            this.#pendingPermissionBySession.delete(sessionId);
          }
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          if (sessionId !== undefined) {
            this.#pendingPermissionBySession.delete(sessionId);
          }
          reject(error);
        }
      });

      if (sessionId !== undefined) {
        this.#pendingPermissionBySession.set(sessionId, id);
      }

      this.#write({
        jsonrpc: "2.0",
        id,
        method,
        params
      } as unknown as JsonRpcSuccess);
    });

    return response as T;
  }

  #handleOutgoingResponse(message: Record<string, unknown>): void {
    const id = typeof message.id === "number" ? message.id : undefined;
    if (id === undefined) {
      return;
    }
    const pending = this.#pendingOutgoing.get(id);
    if (pending === undefined) {
      return;
    }
    this.#pendingOutgoing.delete(id);
    if (typeof message.error === "object" && message.error !== null) {
      pending.reject(new Error(String((message.error as { message?: unknown }).message ?? "ACP client error")));
      return;
    }
    pending.resolve((message as { result?: unknown }).result);
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

function summarizeToolContent(event: Record<string, unknown>): Array<Record<string, unknown>> {
  const summary = summarizeToolResult({
    decision: typeof event.decision === "string" ? event.decision : undefined,
    ok: typeof event.ok === "boolean" ? event.ok : undefined,
    riskClass: typeof event.riskClass === "string" ? event.riskClass : undefined,
    chars: typeof event.chars === "number" ? event.chars : undefined,
    sentChars: typeof event.sentChars === "number" ? event.sentChars : undefined
  });
  const target = typeof event.targetSummary === "string" ? event.targetSummary : undefined;
  const text = [summary, target].filter((part) => typeof part === "string" && part.length > 0).join(" · ");
  return text.length === 0
    ? []
    : [{ type: "content", content: { type: "text", text } }];
}

function createSessionGrants(): SessionGrants {
  return {
    allowOnce: new Set(),
    allowAlways: new Set(),
    rejectAlways: new Set()
  };
}

function applyPermissionSelection(session: AcpSession, targetKey: string | undefined, optionId: string): void {
  if (targetKey === undefined) {
    return;
  }
  if (optionId === "allow-once") {
    session.grants.allowOnce.add(targetKey);
    return;
  }
  if (optionId === "allow-always") {
    session.grants.allowAlways.add(targetKey);
    return;
  }
  if (optionId === "reject-always") {
    session.grants.rejectAlways.add(targetKey);
  }
}

function createAcpSecurityPolicy(
  grants: SessionGrants,
  options: {
    allowEditorRead: boolean;
  }
): SecurityPolicy {
  return {
    decide(request: SecurityRequest): SecurityDecision {
      const targetKey = request.targetKey;
      if (
        options.allowEditorRead === true &&
        request.toolName === "file.read" &&
        request.riskClass === "read-only-local"
      ) {
        return "allow";
      }
      if (targetKey !== undefined) {
        if (grants.rejectAlways.has(targetKey)) {
          return "deny";
        }
        if (grants.allowAlways.has(targetKey)) {
          return "allow";
        }
        if (grants.allowOnce.delete(targetKey)) {
          return "allow";
        }
      }
      return capabilityFirstDefaults.decide(request);
    }
  };
}

function createAcpWorkspaceFsAdapter(input: {
  readTextFile: WorkspaceFsAdapter["readTextFile"];
}): WorkspaceFsAdapter {
  return {
    readTextFile: input.readTextFile
  };
}

function buildAcpRuntimePrompt(input: {
  workspaceRoot: string;
  userText: string;
  editorFsReadAvailable: boolean;
  editorFileContext?: Array<{
    path: string;
    content: string;
  }>;
}): string {
  const contextLines = [
    `ACP editor session for workspace: ${input.workspaceRoot}.`,
    input.editorFsReadAvailable
      ? "Editor-backed file access is available. If the user asks about workspace files such as package.json, README.md, or source files, use file.read instead of asking the user to paste the file contents."
      : "Editor-backed file access is not available in this ACP session."
  ];

  const editorFileSection = input.editorFileContext === undefined || input.editorFileContext.length === 0
    ? []
    : [
        "",
        "[ACP Editor File Context]",
        ...input.editorFileContext.flatMap((file) => [
          `Path: ${file.path}`,
          "```",
          file.content,
          "```"
        ])
      ];

  return [
    "[ACP Session Context]",
    ...contextLines,
    ...editorFileSection,
    "",
    "[User Request]",
    input.userText
  ].join("\n");
}

function extractWorkspaceFileReferences(
  text: string,
  workspaceRoot: string
): Array<{
  absolutePath: string;
  relativePath: string;
}> {
  const matches = text.matchAll(/(?:^|[\s`'"])([A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+)(?=$|[\s`'",.:;!?])/g);
  const seen = new Set<string>();
  const references: Array<{ absolutePath: string; relativePath: string }> = [];

  for (const match of matches) {
    const rawPath = match[1];
    if (typeof rawPath !== "string" || rawPath.length === 0) {
      continue;
    }
    const absolutePath = resolve(rawPath.startsWith("/") ? rawPath : join(workspaceRoot, rawPath));
    if (!isWithinWorkspace(workspaceRoot, absolutePath)) {
      continue;
    }
    const relativePath = relative(workspaceRoot, absolutePath) || rawPath;
    if (seen.has(relativePath)) {
      continue;
    }
    seen.add(relativePath);
    references.push({
      absolutePath,
      relativePath
    });
    if (references.length >= 3) {
      break;
    }
  }

  return references;
}

function isWithinWorkspace(workspaceRoot: string, candidate: string): boolean {
  const normalizedRoot = resolve(workspaceRoot);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}

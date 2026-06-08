import type { EvalCase, EvalResult } from "../../contracts/eval.js";
import { SQLiteSessionDB } from "../../session/sqlite-session-db.js";
import { SQLiteWorkflowStore } from "../../workflow/sqlite-workflow-store.js";
import { assertTrue, assertEqual, buildResult } from "../eval-runner.js";
import { rmSync } from "node:fs";

export const taskflowMigrationCase: EvalCase = {
  id: "taskflow-migration",
  name: "v0.8 schema migration creates tables and sets version",
  description: "SQLiteSessionDB introduces schema_version and v0.8 TaskFlow tables on first open.",
  tags: ["taskflow", "migration", "deterministic"],
  run: async (): Promise<EvalResult> => {
    const startedAt = Date.now();
    const dbPath = `/tmp/estacoda-eval-migration-${Date.now()}.db`;
    const assertions = [];

    try {
      // Fresh DB
      const sessionDb = new SQLiteSessionDB({ path: dbPath });

      // schema_version should be 1
      const versionRow = sessionDb.db
        .query<{ version: number }>("select version from schema_version limit 1")
        .get();
      assertions.push(assertEqual("schema_version is 1", versionRow?.version, 1));

      // v0.8 tables exist
      const tables = sessionDb.db
        .query<{ name: string }>("select name from sqlite_master where type='table'")
        .all()
        .map((r) => r.name);
      assertions.push(assertTrue("flows table exists", tables.includes("flows")));
      assertions.push(assertTrue("flow_steps table exists", tables.includes("flow_steps")));
      assertions.push(assertTrue("flow_events table exists", tables.includes("flow_events")));
      assertions.push(assertTrue("operator_events table exists", tables.includes("operator_events")));
      assertions.push(assertTrue("flow_locks table exists", tables.includes("flow_locks")));
      assertions.push(assertTrue("checkpoints table exists", tables.includes("checkpoints")));
      assertions.push(assertTrue("approval_gates table exists", tables.includes("approval_gates")));
      assertions.push(assertTrue("flow_processes table exists", tables.includes("flow_processes")));
      assertions.push(assertTrue("flow_artifacts table exists", tables.includes("flow_artifacts")));
      assertions.push(assertTrue("flow_run_links table exists", tables.includes("flow_run_links")));

      // Indexes exist
      const indexes = sessionDb.db
        .query<{ name: string }>("select name from sqlite_master where type='index'")
        .all()
        .map((r) => r.name);
      assertions.push(assertTrue("idx_flows_status exists", indexes.includes("idx_flows_status")));
      assertions.push(assertTrue("idx_flow_locks_expires exists", indexes.includes("idx_flow_locks_expires")));

      // Store can write and read a flow
      const store = new SQLiteWorkflowStore({ db: sessionDb.db });
      const flow = makeTestFlow("flow-1");
      await store.createWorkflowRun(flow);
      const retrieved = await store.getWorkflowRun("flow-1");
      assertions.push(assertTrue("flow round-trip", retrieved !== null));
      assertions.push(assertEqual("flow sessionId", retrieved?.sessionId, flow.sessionId));
      assertions.push(assertEqual("flow status", retrieved?.status, flow.status));

      sessionDb.close();
    } finally {
      try { rmSync(dbPath); } catch { /* ignore */ }
    }

    return buildResult("taskflow-migration", "v0.8 schema migration creates tables and sets version", assertions, Date.now() - startedAt);
  }
};

function makeTestFlow(id: string) {
  return {
    id,
    sessionId: "session-1",
    status: "pending" as const,
    intent: {
      nativeIntent: "general" as const,
      labels: ["test"],
      confidence: 1,
      suggestedToolsets: [],
      suggestedSkills: [],
      confirmationRequired: false,
      evidence: [],
      rationale: "test"
    },
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    checkpointCount: 0,
    stepCount: 0,
    retryCount: 0,
    metadata: {}
  };
}

/**
 * DSPy/GEPA-compatible export format for EstaCoda evolution data.
 *
 * No Python dependency. This is a clean JSON schema for future
 * consumption by external optimization pipelines.
 */

export type OptimizationDataset = {
  version: "v0.7";
  generatedAt: string;
  meta: {
    skillCount: number;
    proposalCount: number;
    manifestCount: number;
    observationCount: number;
    evalRunCount: number;
  };
  traces: Array<{
    id: string;
    sessionId: string;
    events: Array<{
      kind: string;
      timestamp: string;
      metadata: Record<string, unknown>;
    }>;
    outcome: "success" | "failure" | "cancelled";
    failureClass?: string;
  }>;
  skillEvalRuns: Array<{
    skillName: string;
    evalId: string;
    score: number;
    passed: boolean;
    details: Record<string, boolean>;
  }>;
  observations: Array<{
    id: string;
    skillName: string;
    type: string;
    lesson: string;
    outcome: string;
    toolsAttempted: string[];
  }>;
  proposals: Array<{
    id: string;
    skillName: string;
    status: string;
    hypothesis?: string;
    predictedImpact?: string;
    riskLevel?: string;
  }>;
  manifests: Array<{
    id: string;
    target: string;
    status: string;
    hypothesis: string;
    predictedImpact: string;
    riskLevel: string;
    filesChanged: string[];
    evidenceTraces: string[];
    constraintGates: string[];
    rollbackPlan: string;
    createdAt: string;
  }>;
};

export type ExportFilter = {
  since?: Date;
  skillName?: string;
  target?: string;
};

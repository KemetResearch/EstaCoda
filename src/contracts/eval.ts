export type EvalAssertion = {
  name: string;
  passed: boolean;
  expected?: string;
  actual?: string;
};

export type EvalResult = {
  id: string;
  name: string;
  passed: boolean;
  assertions: EvalAssertion[];
  durationMs: number;
  error?: string;
};

export type EvalCase = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  run: () => Promise<EvalResult>;
};

export type EvalReport = {
  results: EvalResult[];
  passed: number;
  failed: number;
  durationMs: number;
};

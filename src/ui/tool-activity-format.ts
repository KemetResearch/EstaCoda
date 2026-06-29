export function humanRisk(riskClass: string | undefined): string {
  switch (riskClass) {
    case "destructive-local":
      return "destructive local action";
    case "credential-access":
      return "credential or secret access";
    case "external-side-effect":
      return "external side effect";
    case "spend-money":
      return "may spend money";
    case "sandbox-escape":
      return "sandbox boundary";
    case "workspace-write":
      return "workspace write";
    default:
      return riskClass ?? "policy gate";
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${Math.max(0, ms)}ms`;
  }
  return `${(ms / 1_000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
}

export function formatCount(value: number): string {
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }

  return String(value);
}

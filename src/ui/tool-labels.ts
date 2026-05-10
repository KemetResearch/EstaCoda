// Tool-name to human label-key mapping for the tool activity rail.
// Renderers look up the localized string via chromeCopy.

export function toolActivityLabelKey(tool: string): string {
  if (tool.includes("read") || tool.includes("workspace") || tool.includes("file")) return "read";
  if (tool.includes("write") || tool.includes("artifact") || tool.includes("trajectory")) return "write";
  if (tool.includes("terminal") || tool.includes("process") || tool.includes("execute") || tool.includes("python")) return "run";
  if (tool.includes("web") || tool.includes("browser")) return "fetch";
  if (tool.includes("review")) return "review";
  if (tool.includes("memory")) return "memo";
  if (tool.includes("delegate")) return "delegate";
  if (tool.includes("config") || tool.includes("onboarding")) return "config";
  if (tool.includes("media")) return "media";
  if (tool.includes("skill") || tool.includes("workflow")) return "plan";
  return "run";
}

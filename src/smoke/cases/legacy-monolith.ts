import type { SmokeCase } from "../smoke-case.js";
import { runLegacySmoke } from "../_legacy.js";

export const legacy_monolith_case: SmokeCase = {
  id: "legacy-monolith",
  name: "Legacy monolithic smoke (all subsystems)",
  tags: ["legacy", "all"],
  run: runLegacySmoke
};

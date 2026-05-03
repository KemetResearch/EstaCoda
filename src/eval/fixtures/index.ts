import { providerTextResponseCase } from "./provider-text-response.js";
import { toolSecurityBlockCase } from "./tool-security-block.js";
import { missingToolFailureCase } from "./missing-tool-failure.js";

export const defaultEvalFixtures = [
  providerTextResponseCase,
  toolSecurityBlockCase,
  missingToolFailureCase
];

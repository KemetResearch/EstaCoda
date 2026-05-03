import { providerTextResponseCase } from "./provider-text-response.js";
import { toolSecurityBlockCase } from "./tool-security-block.js";
import { missingToolFailureCase } from "./missing-tool-failure.js";
import { memoryPromotionProvenanceCase } from "./memory-promotion-provenance.js";
import { memoryDeactivateSuppressesCase } from "./memory-deactivate-suppresses.js";
import { memorySelectiveRendersCase } from "./memory-selective-renders.js";
import { memorySafetyFilesProtectedCase } from "./memory-safety-files-protected.js";

export const defaultEvalFixtures = [
  providerTextResponseCase,
  toolSecurityBlockCase,
  missingToolFailureCase,
  memoryPromotionProvenanceCase,
  memoryDeactivateSuppressesCase,
  memorySelectiveRendersCase,
  memorySafetyFilesProtectedCase
];

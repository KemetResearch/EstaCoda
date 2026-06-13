export type ManagedPythonCapabilityOptionalGroup = {
  packages: string[];
  verifyImports: string[];
  estimatedInstallSizeMb?: number;
};

export type ManagedPythonCapabilityEnvSpec = {
  id: string;
  version: string;
  packages: string[];
  verifyImports: string[];
  pythonVersion?: string;
  estimatedInstallSizeMb?: number;
  optionalGroups?: Record<string, ManagedPythonCapabilityOptionalGroup>;
};

export const FASTER_WHISPER_CAPABILITY_ID = "faster-whisper";

const DEFAULT_REGISTERED_CAPABILITY_SPECS: ManagedPythonCapabilityEnvSpec[] = [
  {
    id: FASTER_WHISPER_CAPABILITY_ID,
    version: "1.2.1",
    packages: ["faster-whisper==1.2.1"],
    verifyImports: ["faster_whisper"]
  }
];

let registeredCapabilitySpecs = DEFAULT_REGISTERED_CAPABILITY_SPECS.map(cloneSpec);
let specsById = buildSpecMap(registeredCapabilitySpecs);

export function listRegisteredPythonCapabilitySpecs(): ManagedPythonCapabilityEnvSpec[] {
  return registeredCapabilitySpecs.map(cloneSpec);
}

export function getRegisteredPythonCapabilitySpec(id: string): ManagedPythonCapabilityEnvSpec | undefined {
  const spec = specsById.get(id);
  return spec === undefined ? undefined : cloneSpec(spec);
}

export function requireRegisteredPythonCapabilitySpec(id: string): ManagedPythonCapabilityEnvSpec {
  const spec = getRegisteredPythonCapabilitySpec(id);
  if (spec === undefined) {
    throw new Error(`Unknown managed Python capability: ${id}`);
  }
  return spec;
}

export function isRegisteredPythonCapabilityId(id: string): boolean {
  return specsById.has(id);
}

export function registerPythonCapabilitySpecForTest(spec: ManagedPythonCapabilityEnvSpec): void {
  const existingIndex = registeredCapabilitySpecs.findIndex((entry) => entry.id === spec.id);
  const cloned = cloneSpec(spec);
  if (existingIndex >= 0) {
    registeredCapabilitySpecs[existingIndex] = cloned;
  } else {
    registeredCapabilitySpecs.push(cloned);
  }
  specsById = buildSpecMap(registeredCapabilitySpecs);
}

export function resetPythonCapabilityRegistryForTest(): void {
  registeredCapabilitySpecs = DEFAULT_REGISTERED_CAPABILITY_SPECS.map(cloneSpec);
  specsById = buildSpecMap(registeredCapabilitySpecs);
}

function buildSpecMap(specs: ManagedPythonCapabilityEnvSpec[]): Map<string, ManagedPythonCapabilityEnvSpec> {
  return new Map(specs.map((spec) => [spec.id, spec]));
}

function cloneSpec(spec: ManagedPythonCapabilityEnvSpec): ManagedPythonCapabilityEnvSpec {
  return {
    ...spec,
    packages: [...spec.packages],
    verifyImports: [...spec.verifyImports],
    optionalGroups: spec.optionalGroups === undefined
      ? undefined
      : Object.fromEntries(Object.entries(spec.optionalGroups).map(([groupId, group]) => [
        groupId,
        {
          ...group,
          packages: [...group.packages],
          verifyImports: [...group.verifyImports]
        }
      ]))
  };
}

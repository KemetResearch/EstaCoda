import {
  isAlwaysBlockedHostname,
  isAlwaysBlockedNetwork,
  isPrivateOrInternalIp,
  normalizeHostname,
  normalizeIpForChecks,
  parseHttpUrl,
  resolveHostname,
  type ResolveHostnameFn
} from "./url-safety.js";

export type BrowserUrlClassification =
  | "public"
  | "private-or-internal"
  | "always-blocked"
  | "invalid";

export interface HybridClassifierOptions {
  resolveHostname?: ResolveHostnameFn;
  allowPrivateUrls?: boolean;
}

export interface HybridClassificationResult {
  classification: BrowserUrlClassification;
  reason: string;
  hostname?: string;
  resolvedAddresses?: string[];
}

export async function classifyBrowserUrl(
  url: string,
  options: HybridClassifierOptions = {}
): Promise<HybridClassificationResult> {
  const parsed = parseHttpUrl(url);
  if (parsed === undefined) {
    return {
      classification: "invalid",
      reason: "URL must be a valid HTTP or HTTPS URL"
    };
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (hostname.length === 0) {
    return {
      classification: "invalid",
      reason: "URL hostname is empty"
    };
  }

  if (isAlwaysBlockedHostname(hostname)) {
    return {
      classification: "always-blocked",
      reason: "Hostname is a known metadata endpoint",
      hostname
    };
  }

  const literalIp = normalizeIpForChecks(hostname);
  if (literalIp !== undefined) {
    return classifyAddress(literalIp, {
      hostname,
      reasonPrefix: "Literal address"
    });
  }

  if (isInternalHostname(hostname)) {
    return {
      classification: "private-or-internal",
      reason: "Hostname is private or internal",
      hostname
    };
  }

  let resolvedAddresses: string[];
  try {
    resolvedAddresses = await resolveHostname(hostname, options.resolveHostname);
  } catch {
    return {
      classification: "private-or-internal",
      reason: "Hostname resolution failed; treating as private or internal",
      hostname
    };
  }

  if (resolvedAddresses.length === 0) {
    return {
      classification: "private-or-internal",
      reason: "Hostname resolved to no addresses; treating as private or internal",
      hostname,
      resolvedAddresses
    };
  }

  let sawPrivateOrInternal = false;
  for (const address of resolvedAddresses) {
    const normalizedIp = normalizeIpForChecks(address);
    if (normalizedIp === undefined) {
      return {
        classification: "private-or-internal",
        reason: "Hostname resolved to a non-IP address; treating as private or internal",
        hostname,
        resolvedAddresses
      };
    }
    if (isAlwaysBlockedNetwork(normalizedIp)) {
      return {
        classification: "always-blocked",
        reason: "Hostname resolves to a known metadata endpoint",
        hostname,
        resolvedAddresses
      };
    }
    if (isPrivateOrInternalIp(normalizedIp)) {
      sawPrivateOrInternal = true;
    }
  }

  if (sawPrivateOrInternal) {
    return {
      classification: "private-or-internal",
      reason: "Hostname resolves to a private or internal address",
      hostname,
      resolvedAddresses
    };
  }

  return {
    classification: "public",
    reason: "URL and resolved addresses are public",
    hostname,
    resolvedAddresses
  };
}

function classifyAddress(
  address: string,
  options: {
    hostname: string;
    reasonPrefix: string;
  }
): HybridClassificationResult {
  if (isAlwaysBlockedNetwork(address)) {
    return {
      classification: "always-blocked",
      reason: `${options.reasonPrefix} is a known metadata endpoint`,
      hostname: options.hostname
    };
  }

  if (isPrivateOrInternalIp(address)) {
    return {
      classification: "private-or-internal",
      reason: `${options.reasonPrefix} is private or internal`,
      hostname: options.hostname
    };
  }

  return {
    classification: "public",
    reason: `${options.reasonPrefix} is public`,
    hostname: options.hostname
  };
}

function isInternalHostname(hostname: string): boolean {
  return hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    !hostname.includes(".");
}

import type { MemoryConclusion, MemoryProvider } from "../contracts/memory.js";
import type { SessionDB } from "../contracts/session.js";
import { stripInlineReasoning } from "../providers/provider-reasoning.js";

export type UserPreferencePromotionResult =
  | {
      kind: "conclusion";
      conclusion: MemoryConclusion;
    }
  | {
      kind: "forgotten";
      content: string;
    };

export type ProjectFactPromotionResult = {
  kind: "conclusion";
  conclusion: MemoryConclusion;
};

type PromotionStatementCandidate = {
  text: string;
  source: "direct-user-input";
  index: number;
};

const MAX_PROMOTION_STATEMENT_CANDIDATES = 8;

export async function resolveUserPreferencePromotion(options: {
  profileId: string;
  currentUserText: string;
  sessionDb: SessionDB;
  memoryProvider: MemoryProvider;
  sourceTrajectoryId?: string;
  sourceEventId?: string;
}): Promise<UserPreferencePromotionResult | undefined> {
  const currentCandidates = extractPromotionStatementCandidates(options.currentUserText);
  for (const currentCandidate of currentCandidates) {
    const forgottenContent = detectForgetPreference(currentCandidate.text);
    if (forgottenContent !== undefined && options.memoryProvider.forgetPromotion !== undefined) {
      const forgotten = await options.memoryProvider.forgetPromotion(forgottenContent);
      if (forgotten !== undefined) {
        return {
          kind: "forgotten",
          content: forgotten.content
        };
      }
    }
  }

  const currentPreference = firstDetectedCandidate(currentCandidates, detectUserPreference);

  if (currentPreference === undefined) {
    return undefined;
  }

  const matchingSessionIds = new Set<string>();
  const matches = await options.sessionDb.search(searchQueryForPreference(currentPreference), {
    profileId: options.profileId,
    limit: 50,
    rootSessionsOnly: true
  });

  for (const match of matches) {
    if (match.message.role !== "user") {
      continue;
    }

    const candidate = firstDetectedCandidate(
      extractPromotionStatementCandidates(match.message.content),
      detectUserPreference
    );
    if (candidate?.key === currentPreference.key) {
      matchingSessionIds.add(match.session.id);
    }
  }

  if (matchingSessionIds.size < 2) {
    return undefined;
  }

  const conclusion: MemoryConclusion = {
    id: `memory-preference-${currentPreference.key}`,
    kind: "user-preference",
    content: currentPreference.content,
    confidence: Math.min(0.95, 0.55 + (matchingSessionIds.size - 2) * 0.15),
    source: "repeated-user-input",
    occurrences: matchingSessionIds.size,
    sourceSessionIds: [...matchingSessionIds],
    sourceTrajectoryId: options.sourceTrajectoryId,
    sourceEventId: options.sourceEventId,
    createdAt: new Date().toISOString()
  };

  await options.memoryProvider.conclude(conclusion);
  return {
    kind: "conclusion",
    conclusion
  };
}

export async function resolveProjectFactPromotion(options: {
  profileId: string;
  currentUserText: string;
  sessionDb: SessionDB;
  memoryProvider: MemoryProvider;
  sourceTrajectoryId?: string;
  sourceEventId?: string;
}): Promise<ProjectFactPromotionResult | undefined> {
  const currentFact = firstDetectedCandidate(
    extractPromotionStatementCandidates(options.currentUserText),
    detectProjectFact
  );

  if (currentFact === undefined) {
    return undefined;
  }

  const matchingSessionIds = new Set<string>();
  const matches = await options.sessionDb.search(currentFact.content, {
    profileId: options.profileId,
    limit: 50,
    rootSessionsOnly: true
  });

  for (const match of matches) {
    if (match.message.role !== "user") {
      continue;
    }

    const candidate = firstDetectedCandidate(
      extractPromotionStatementCandidates(match.message.content),
      detectProjectFact
    );
    if (candidate?.key === currentFact.key) {
      matchingSessionIds.add(match.session.id);
    }
  }

  if (matchingSessionIds.size < 2) {
    return undefined;
  }

  const conclusion: MemoryConclusion = {
    id: `memory-project-fact-${currentFact.key}`,
    kind: "project-fact",
    content: currentFact.content,
    confidence: Math.min(0.95, 0.55 + (matchingSessionIds.size - 2) * 0.15),
    source: "repeated-user-input",
    occurrences: matchingSessionIds.size,
    sourceSessionIds: [...matchingSessionIds],
    sourceTrajectoryId: options.sourceTrajectoryId,
    sourceEventId: options.sourceEventId,
    createdAt: new Date().toISOString()
  };

  await options.memoryProvider.conclude(conclusion);
  return {
    kind: "conclusion",
    conclusion
  };
}

type PreferenceCandidate = {
  key: string;
  content: string;
  category?: string;
  value?: string;
};

function firstDetectedCandidate(
  candidates: readonly PromotionStatementCandidate[],
  detect: (text: string) => PreferenceCandidate | undefined
): PreferenceCandidate | undefined {
  for (const candidate of candidates) {
    const detected = detect(candidate.text);
    if (detected !== undefined) {
      return detected;
    }
  }
  return undefined;
}

function extractPromotionStatementCandidates(text: string): PromotionStatementCandidate[] {
  const sanitized = sanitizeMemoryLearningText(text);
  const withoutCodeBlocks = stripFencedCodeBlocks(sanitized);
  const statements = splitDirectStatements(withoutCodeBlocks);
  const candidates: PromotionStatementCandidate[] = [];

  for (const statement of statements) {
    if (hasQuotedOrBacktickedSpan(statement)) {
      continue;
    }
    const normalized = normalize(statement);
    if (normalized.length === 0 || isAmbiguousPromotionStatement(normalized)) {
      continue;
    }
    candidates.push({
      text: normalized,
      source: "direct-user-input",
      index: candidates.length
    });
    if (candidates.length >= MAX_PROMOTION_STATEMENT_CANDIDATES) {
      break;
    }
  }

  return candidates;
}

function stripFencedCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/gu, "\n");
}

function hasQuotedOrBacktickedSpan(text: string): boolean {
  return /["'`]/u.test(text);
}

function splitDirectStatements(text: string): string[] {
  const statements: string[] = [];
  let current = "";

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    current += character;

    if (character === "\n") {
      pushStatement(statements, current);
      current = "";
      continue;
    }

    if (!/[.?!]/u.test(character)) {
      continue;
    }

    const next = text[index + 1];
    if (next === undefined || /\s/u.test(next)) {
      pushStatement(statements, current);
      current = "";
    }
  }

  pushStatement(statements, current);
  return statements;
}

function pushStatement(statements: string[], statement: string): void {
  const trimmed = statement.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }
}

function isAmbiguousPromotionStatement(statement: string): boolean {
  if (statement.length > 180) {
    return true;
  }
  if (statement.split(/\s+/u).length > 24) {
    return true;
  }
  return /^(?:agent note|assistant note|tool output|earlier assistant said|the attached resume says|please summarize this)\b/iu.test(statement);
}

function detectUserPreference(text: string): PreferenceCandidate | undefined {
  const normalized = normalize(text);
  if (normalized.length === 0) {
    return undefined;
  }

  const verbosity = detectVerbosityPreference(normalized);
  if (verbosity !== undefined) {
    return verbosity;
  }

  const canonicalPatterns: Array<{
    regex: RegExp;
    category: string;
  }> = [
    {
      regex: /^(?:i\s+)?prefer\s+(.+)$/iu,
      category: "prefer"
    },
    {
      regex: /^(?:please\s+)?use\s+(.+?)\s+by\s+default$/iu,
      category: "prefer"
    },
    {
      regex: /^(?:please\s+)?default\s+to\s+(.+)$/iu,
      category: "prefer"
    }
  ];
  const nonCanonicalPatterns: Array<{
    regex: RegExp;
    render: (value: string) => string;
    category?: string;
  }> = [
    {
      regex: /^(?:please\s+)?always\s+use\s+(.+)$/iu,
      render: (value) => `Always use ${value}`
    },
    {
      regex: /^(?:we\s+)?want\s+(.+?)\s+by\s+default$/iu,
      render: (value) => `Want ${value} by default`
    }
  ];

  for (const pattern of canonicalPatterns) {
    const match = normalized.match(pattern.regex);
    const captured = match?.[1]?.trim().replace(/[.?!]+$/u, "");

    if (captured === undefined || captured.length === 0) {
      continue;
    }

    const canonical = canonicalPreference(pattern.category, captured);
    if (canonical !== undefined) {
      return canonical;
    }
  }

  for (const pattern of nonCanonicalPatterns) {
    const match = normalized.match(pattern.regex);
    const captured = match?.[1]?.trim().replace(/[.?!]+$/u, "");

    if (captured === undefined || captured.length === 0) {
      continue;
    }

    const content = `${pattern.render(captured)}.`;
    return {
      key: content.toLowerCase(),
      content,
      category: pattern.category,
      value: captured
    };
  }

  return undefined;
}

function canonicalPreference(category: string, value: string): PreferenceCandidate | undefined {
  const normalizedValue = normalizePreferenceValue(value);
  if (normalizedValue.length === 0) {
    return undefined;
  }
  const content = `Prefer ${normalizedValue}.`;
  return {
    key: `${category}:${normalizedValue.toLowerCase()}`,
    content,
    category,
    value: normalizedValue
  };
}

function normalizePreferenceValue(value: string): string {
  return stripTrailingPunctuation(value).replace(/\s+/gu, " ").trim();
}

function searchQueryForPreference(candidate: PreferenceCandidate): string {
  return candidate.value ?? candidate.content;
}

function detectProjectFact(text: string): PreferenceCandidate | undefined {
  const normalized = normalize(text);
  if (normalized.length === 0) {
    return undefined;
  }

  const patterns: Array<{
    regex: RegExp;
    render: (...groups: string[]) => string;
  }> = [
    {
      regex: /^project uses (.+)$/iu,
      render: (value) => `Project uses ${stripTrailingPunctuation(value)}.`
    },
    {
      regex: /^run checks with (.+)$/iu,
      render: (value) => `Run checks with ${ensureWrappedCommand(stripTrailingPunctuation(value))}.`
    },
    {
      regex: /^(.+?) is stored under [`'"]?(.+?)[`'"]?$/iu,
      render: (subject, path) => `${capitalize(stripTrailingPunctuation(subject))} is stored under ${ensureWrappedCommand(stripTrailingPunctuation(path))}.`
    },
    {
      regex: /^(.+?) is persisted in [`'"]?(.+?)[`'"]?$/iu,
      render: (subject, path) => `${capitalize(stripTrailingPunctuation(subject))} is persisted in ${ensureWrappedCommand(stripTrailingPunctuation(path))}.`
    },
    {
      regex: /^run tests with (.+)$/iu,
      render: (value) => `Run tests with ${ensureWrappedCommand(stripTrailingPunctuation(value))}.`
    }
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex);
    if (match === null) {
      continue;
    }

    const groups = match.slice(1).map((group) => stripTrailingPunctuation(group.trim()));
    if (groups.some((group) => group.length === 0)) {
      continue;
    }

    const content = pattern.render(...groups);
    return {
      key: content.toLowerCase(),
      content
    };
  }

  return undefined;
}

function detectVerbosityPreference(normalized: string): PreferenceCandidate | undefined {
  const statement = stripTrailingPunctuation(normalized);
  const concisePatterns = [
    /^(?:i\s+)?prefer\s+concise(?:\s+telegram)?\s+repl(?:y|ies)$/iu,
    /^please\s+keep\s+repl(?:y|ies)\s+concise$/iu,
    /^(?:please\s+)?use\s+concise\s+repl(?:y|ies)$/iu,
    /^(?:please\s+)?give\s+me\s+concise\s+repl(?:y|ies)$/iu
  ];
  const detailedPatterns = [
    /^(?:i\s+)?prefer\s+detailed(?:\s+telegram)?\s+repl(?:y|ies)$/iu,
    /^(?:actually\s+)?give\s+me\s+detailed\s+repl(?:y|ies)$/iu,
    /^please\s+keep\s+repl(?:y|ies)\s+detailed$/iu,
    /^(?:please\s+)?use\s+detailed\s+repl(?:y|ies)$/iu
  ];

  if (concisePatterns.some((pattern) => pattern.test(statement))) {
    return {
      key: "prefer concise replies.",
      content: "Prefer concise replies."
    };
  }

  if (detailedPatterns.some((pattern) => pattern.test(statement))) {
    return {
      key: "prefer detailed replies.",
      content: "Prefer detailed replies."
    };
  }

  return undefined;
}

function detectForgetPreference(text: string): string | undefined {
  const normalized = normalize(text);
  const match = normalized.match(/^(?:please\s+)?forget\s+that\s+i\s+prefer\s+(.+)$/iu);
  const captured = match?.[1]?.trim().replace(/[.?!]+$/u, "");
  if (captured === undefined || captured.length === 0) {
    return undefined;
  }

  if (captured.includes("concise")) {
    return "Prefer concise replies.";
  }
  if (captured.includes("detailed")) {
    return "Prefer detailed replies.";
  }

  return `Prefer ${captured}.`;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function sanitizeMemoryLearningText(value: string): string {
  return stripInlineReasoning(value);
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.?!]+$/u, "").trim();
}

function ensureWrappedCommand(value: string): string {
  if (value.startsWith("`") && value.endsWith("`")) {
    return value;
  }

  return `\`${value}\``;
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return value;
  }

  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

export function __detectUserPreferenceForTest(text: string): string | undefined {
  return detectUserPreference(text)?.content;
}

export function __detectForgetPreferenceForTest(text: string): string | undefined {
  return detectForgetPreference(text);
}

export function __detectProjectFactForTest(text: string): string | undefined {
  return detectProjectFact(text)?.content;
}

export function __extractPromotionStatementCandidatesForTest(text: string): PromotionStatementCandidate[] {
  return extractPromotionStatementCandidates(text);
}

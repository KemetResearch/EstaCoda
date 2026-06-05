const SEARCH_TERM_SPLIT_PATTERN = /[^a-z0-9\u0600-\u06ff]+/u;

export function tokenizeSearchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(SEARCH_TERM_SPLIT_PATTERN)
    .filter((term) => term.length > 1);
}

export function toFtsQuery(query: string): string {
  return tokenizeSearchTerms(query)
    .map((term) => quoteFtsTerm(term))
    .join(" OR ");
}

export function quoteFtsTerm(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}

// FR-CONTRIB-9: external profile URL for a stored (already normalized) authority identifier.
const URLS: Record<string, (v: string) => string> = {
  orcid: (v) => `https://orcid.org/${v}`,
  isni: (v) => `https://isni.org/isni/${v}`,
  viaf: (v) => `https://viaf.org/viaf/${v}`,
  wikidata: (v) => `https://www.wikidata.org/wiki/${v}`,
  openlibrary: (v) => `https://openlibrary.org/authors/${v}`,
  semantic_scholar: (v) => `https://www.semanticscholar.org/author/${v}`,
};

export function authorityUrl(scheme: string, value: string): string | null {
  return URLS[scheme]?.(encodeURIComponent(value)) ?? null;
}

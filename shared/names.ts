// shared/names.ts — dependency-free so both Vite and Deno can import it (§12).
//
// Only formatByline() is implemented. The rest of §6.3 (parseName, fold, match_key,
// compareGiven, contributor-matching scoring) is a separate, larger slice of work
// (paste-parsing UI, the matching/merge/split flows) and is not started yet.

export interface Credit {
  role: string;
  position: number;
  credited_as: string | null;
  display_name: string;
}

// FR-CONTRIB-4: no authors → fall back to editors, then compilers, then translators.
const BYLINE_FALLBACK_ORDER = ['author', 'editor', 'compiler', 'translator'] as const;
const FALLBACK_SUFFIX: Record<string, string> = { editor: ' (ed.)', compiler: ' (comp.)', translator: ' (trans.)' };

export function formatByline(credits: Credit[]): string {
  for (const role of BYLINE_FALLBACK_ORDER) {
    const inRole = credits.filter((c) => c.role === role).sort((a, b) => a.position - b.position);
    if (inRole.length === 0) continue;
    const names = inRole.map((c) => c.credited_as || c.display_name);
    const joined =
      names.length <= 1
        ? names[0] ?? ''
        : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
    return joined + (role === 'author' ? '' : FALLBACK_SUFFIX[role]);
  }
  return '';
}

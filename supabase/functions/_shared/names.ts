// _shared/names.ts — name parsing, folding, and matching support (§6.3). Dependency-free so
// both Vite and Deno can import it (§12). formatByline() below is FR-CONTRIB-4; everything
// else here is FR-CONTRIB-2/3 (structured names, paste parsing) plus compareGiven(), the one
// piece of FR-CONTRIB-6 (M2 matching) simple enough to build alongside parsing.
//
// NOT implemented: contributor_candidates() scoring/decide (needs the DB RPC), the review
// queue, and merge/split UI — those are M2/M3.

export type Role = 'author' | 'editor' | 'compiler' | 'translator' | 'illustrator' | 'series_editor' | 'introduction' | 'contributor';

// ---------------------------------------------------------------------------
// formatByline (FR-CONTRIB-4)
// ---------------------------------------------------------------------------

export interface Credit {
  role: string;
  position: number;
  credited_as: string | null;
  display_name: string;
}

const BYLINE_FALLBACK_ORDER = ['author', 'editor', 'compiler', 'translator'] as const;
const FALLBACK_SUFFIX: Record<string, string> = { editor: ' (ed.)', compiler: ' (comp.)', translator: ' (trans.)' };

export function formatByline(credits: Credit[]): string {
  for (const role of BYLINE_FALLBACK_ORDER) {
    const inRole = credits.filter((c) => c.role === role).sort((a, b) => a.position - b.position);
    if (inRole.length === 0) continue;
    const names = inRole.map((c) => c.credited_as || c.display_name);
    const joined = names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`;
    return joined + (role === 'author' ? '' : FALLBACK_SUFFIX[role]);
  }
  return '';
}

// ---------------------------------------------------------------------------
// fold() — match_key and all name comparisons
// ---------------------------------------------------------------------------

// Letters NFKD does not decompose into base + combining mark.
const FOLD_MAP: Record<string, string> = {
  ı: 'i', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ß: 'ss', æ: 'ae', œ: 'oe',
};

export function fold(input: string): string {
  let s = input.toLowerCase();
  s = s.replace(/[ıøłđðþßæœ]/g, (ch) => FOLD_MAP[ch] ?? ch);
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, ''); // strip combining marks (incl. cedilla, acute, etc.)
  s = s.replace(/[^\p{L}\p{M}]|[ʹʺʼ]/gu, ''); // Unicode letters and script marks — punctuation, digits and spaces disappear
  return s;
}

// ---------------------------------------------------------------------------
// Organization detection
// ---------------------------------------------------------------------------

// Calibre's `author_name_copywords` default (resources/default_tweaks.py) plus §6.3's list.
const ORG_WORDS = new Set([
  'agency', 'corporation', 'company', 'co', 'council', 'committee', 'inc', 'institute', 'national',
  'society', 'club', 'team', 'software', 'games', 'entertainment', 'media', 'studios',
  'university', 'collaboration', 'consortium', 'association', 'foundation', 'press', 'ministry',
  'department', 'organization', 'group', 'gmbh', 'ltd', 'llc', 'ag', 'gesellschaft', 'verein', 'contractors',
]);

export function isOrganization(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const words = trimmed.split(/\s+/);
  if (words.length === 1 && /^[A-Z]{2,}$/.test(trimmed)) return true; // single all-caps token, e.g. OECD
  return words.some((w) => ORG_WORDS.has(stripTrailing(w.toLowerCase(), '.,;')));
}

// ---------------------------------------------------------------------------
// Junk filter (§6.3 "Matching" point 6 / validation table)
// ---------------------------------------------------------------------------

// ponytail: not exhaustive — only the app names the spec's validation run actually found.
// Extend as real junk shows up in the review queue.
const KNOWN_JUNK_APPS = new Set(['camscanner', 'unknown']);

export function isJunk(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  // \x00-\x08 and \x0e-\x1f are genuine control characters, not a typo.
  // eslint-disable-next-line no-control-regex
  // Control bytes are intentionally rejected in contributor names.
  // deno-lint-ignore no-control-regex
  if (/[\x00-\x08\x0e-\x1f]/.test(trimmed)) return true;
  if (/^[a-z]+$/.test(trimmed)) return true; // lowercase single token, e.g. an OS username
  if (/[/\\]/.test(trimmed) || /^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed)) return true;
  if (/\d{6,}/.test(trimmed)) return true; // long digit run, e.g. an ISBN
  if (KNOWN_JUNK_APPS.has(trimmed.toLowerCase())) return true;
  return false;
}

// ---------------------------------------------------------------------------
// parseName() — a single name string into structured parts
// ---------------------------------------------------------------------------

export interface PersonParts {
  kind: 'person';
  displayName: string;
  familyName: string;
  givenNames: string | null;
  particle: string | null;
  suffix: string | null;
  sortName: string;
  matchKey: string;
  birthYear: number | null;
  variantName: string | null; // a parenthesized fuller form, e.g. "(Leslie Clifford)"
}

export interface OrganizationParts {
  kind: 'organization';
  displayName: string;
  sortName: string;
  matchKey: string;
}

export type NameParts = PersonParts | OrganizationParts;

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'professor', 'sir']);
const PARTICLES = new Set(['van', 'von', 'de', 'da', 'di', 'del', 'della', 'der', 'den', 'du', 'la', 'le', 'ten', 'ter', 'bin', 'ibn', 'al', 'el']);
const SUFFIX_RE = /^(Jr|Sr|II|III|IV|PhD|MD)\.?$/;
const ROLE_MARKER_RE: [RegExp, Role[]][] = [
  [/^eds?\.?$/i, ['editor']],
  [/^editors?$/i, ['editor']],
  [/^trans\.?$/i, ['translator']],
  [/^translators?$/i, ['translator']],
  [/^auths?\.?$/i, ['author']],
  [/^authors?$/i, ['author']],
];

function titleCase(s: string): string {
  return s.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function isAllCaps(s: string): boolean {
  return /[A-Z]/.test(s) && !/[a-z]/.test(s);
}

// A trailing "(...)" is either a role marker ((ed.), (auth.), ...) or a fuller-form variant
// name ((Leslie Clifford)) — never both. Returns the marker's roles, or the variant text.
function extractTrailingParen(s: string): { rest: string; roles: Role[]; variant: string | null } {
  const trimmed = s.trim();
  const open = trimmed.endsWith(')') ? trimmed.lastIndexOf('(') : -1;
  const m = open >= 0 && !trimmed.slice(open + 1, -1).includes(')') ? [trimmed, trimmed.slice(0, open), trimmed.slice(open + 1, -1)] : null;
  if (!m) return { rest: trimmed, roles: [], variant: null };
  const inner = m[2].trim();
  for (const [pattern, roles] of ROLE_MARKER_RE) {
    if (pattern.test(inner)) return { rest: m[1].trim(), roles, variant: null };
  }
  return { rest: m[1].trim(), roles: [], variant: inner || null };
}

function splitParticle(familySegment: string): { particle: string | null; family: string } {
  const tokens = familySegment.trim().split(/\s+/);
  const particleTokens: string[] = [];
  while (tokens.length > 1 && PARTICLES.has(tokens[0].toLowerCase())) {
    particleTokens.push(tokens.shift()!);
  }
  return { particle: particleTokens.length ? particleTokens.join(' ') : null, family: tokens.join(' ') };
}

export interface ParseNameResult {
  parts: NameParts;
  extraRoles: Role[]; // from a trailing "(ed.)"-style marker on this specific name
}

interface PersonFields {
  familyName: string;
  givenNames: string | null;
  particle: string | null;
  suffix: string | null;
  birthYear: number | null;
}

function stripHonorifics(name: string): string {
  let working = name;
  for (;;) {
    const firstSpace = working.indexOf(' ');
    if (firstSpace === -1) return working;
    const firstToken = working.slice(0, firstSpace).replace(/\.$/, '');
    if (!HONORIFICS.has(firstToken.toLowerCase())) return working;
    working = working.slice(firstSpace + 1).trim();
  }
}

// "Family, Given[, Suffix][, 1942-]"
function parseCommaForm(commaParts: string[]): PersonFields {
  let rest = commaParts.slice(1);
  let birthYear: number | null = null;
  let suffix: string | null = null;
  const last = rest.at(-1);
  if (last && /^\d{3,4}-\d{0,4}$/.test(last)) {
    birthYear = Number.parseInt(last, 10);
    rest = rest.slice(0, -1);
  }
  const lastAfterYear = rest.at(-1);
  if (lastAfterYear && SUFFIX_RE.test(lastAfterYear)) {
    suffix = lastAfterYear;
    rest = rest.slice(0, -1);
  }
  const { particle, family } = splitParticle(commaParts[0]);
  return { familyName: family, givenNames: rest.length ? rest.join(', ') : null, particle, suffix, birthYear };
}

// "Given [particle] Family [Suffix]", or family-first initials ("Bergman T.L.").
function parseSpaceForm(working: string): PersonFields {
  const tokens = working.split(/\s+/).filter(Boolean);
  const isInitials = (t: string) => /^([A-Z]\.){1,4}$/.test(t);
  if (tokens.length === 2 && !isInitials(tokens[0]) && isInitials(tokens[1])) {
    return { familyName: tokens[0], givenNames: tokens[1], particle: null, suffix: null, birthYear: null };
  }
  let rest = [...tokens];
  let suffix: string | null = null;
  if (rest.length > 1 && SUFFIX_RE.test(rest.at(-1)!)) {
    suffix = rest.at(-1)!;
    rest = rest.slice(0, -1);
  }
  // The last token is the family name, preceded by any particles (scan backward from it).
  const familyName = rest.at(-1) ?? working;
  const particleTokens: string[] = [];
  let idx = rest.length - 2;
  while (idx >= 0 && PARTICLES.has(rest[idx].toLowerCase())) {
    particleTokens.unshift(rest[idx]);
    idx--;
  }
  const givenTokens = rest.slice(0, idx + 1);
  return {
    familyName,
    givenNames: givenTokens.length ? givenTokens.join(' ') : null,
    particle: particleTokens.length ? particleTokens.join(' ') : null,
    suffix,
    birthYear: null,
  };
}

export function parseName(raw: string): ParseNameResult {
  const { rest: afterParen, roles: extraRoles, variant } = extractTrailingParen(raw);
  const working = stripHonorifics(afterParen);

  if (isOrganization(working)) {
    const displayName = working;
    return {
      extraRoles,
      parts: { kind: 'organization', displayName, sortName: displayName, matchKey: fold(displayName) },
    };
  }

  const wasAllCaps = isAllCaps(working);
  const commaParts = working.split(',').map((p) => p.trim()).filter(Boolean);
  const fields = commaParts.length >= 2 ? parseCommaForm(commaParts) : parseSpaceForm(working);
  let { familyName, givenNames, particle } = fields;
  const { suffix, birthYear } = fields;

  if (wasAllCaps) {
    familyName = titleCase(familyName);
    givenNames = givenNames ? titleCase(givenNames) : null;
    particle = particle ? titleCase(particle) : null;
  }

  const displayName = [givenNames, particle, familyName].filter(Boolean).join(' ') + (suffix ? ` ${suffix}` : '');
  const sortName = [particle, familyName].filter(Boolean).join(' ') + (givenNames ? `, ${givenNames}` : '');

  return {
    extraRoles,
    parts: {
      kind: 'person',
      displayName,
      familyName,
      givenNames,
      particle,
      suffix,
      sortName,
      matchKey: fold(familyName),
      birthYear,
      variantName: variant,
    },
  };
}

// ---------------------------------------------------------------------------
// splitNames() — pasted / extracted text into a previewable, editable credit list
// ---------------------------------------------------------------------------

export interface ParsedCredit {
  raw: string; // as it appeared before parsing — becomes credited_as when it differs from the display name
  parts: NameParts | null; // null when rejected as junk
  roles: Role[];
  rejected: boolean;
}

const LEADING_ROLE_PHRASES: [RegExp, Role[]][] = [
  [/^edited and with an introduction by\s+/i, ['editor', 'introduction']],
  [/^edited by\s+/i, ['editor']],
  [/^compiled by\s+/i, ['compiler']],
  [/^translated by\s+/i, ['translator']],
];

function isSingleWord(s: string): boolean {
  return s.trim().split(/\s+/).length === 1;
}
function isBareInitial(s: string): boolean {
  return /^[A-Za-z]\.?$/.test(s.trim());
}

function makeCredit(nameStr: string, raw: string, roles: Role[], birthYearOverride: number | null = null): ParsedCredit {
  if (isJunk(nameStr)) return { raw, parts: null, roles, rejected: true };
  const { parts, extraRoles } = parseName(nameStr);
  if (birthYearOverride !== null && parts.kind === 'person') parts.birthYear = birthYearOverride;
  return { raw, parts, roles: extraRoles.length ? extraRoles : roles, rejected: false };
}

// "1942-" / "1942-2001" -> 1942; anything else -> null.
function birthYearOf(segment: string | undefined): number | null {
  return segment && /^\d{3,4}-\d{0,4}$/.test(segment) ? Number.parseInt(segment, 10) : null;
}

// Comma-separated segments -> credits: "Family, Given[, 1942-]" pairs, "Given Family, Given Family"
// lists, and dropped truncated initials.
function creditsFromSegments(segments: string[], part: string, roles: Role[]): ParsedCredit[] {
  const out: ParsedCredit[] = [];
  let i = 0;
  while (i < segments.length) {
    const seg = segments[i];
    const next = segments[i + 1];

    if (isSingleWord(seg) && next !== undefined) {
      const birthYear = birthYearOf(segments[i + 2]);
      out.push(makeCredit(`${seg}, ${next}`, part, roles, birthYear));
      i += birthYear === null ? 2 : 3;
      continue;
    }
    if (next !== undefined && isSingleWord(next) && !isBareInitial(next)) {
      out.push(makeCredit(`${seg}, ${next}`, part, roles));
      i += 2;
      continue;
    }
    if (isBareInitial(seg)) {
      i += 1; // truncated fragment left by a comma-separated list — dropped, not shown
      continue;
    }
    out.push(makeCredit(seg, part, roles));
    i += 1;
  }
  return out;
}

function processPart(part: string, defaultRoles: Role[]): ParsedCredit[] {
  const { rest, roles: markerRoles, variant } = extractTrailingParen(part);
  // A non-role trailing paren here (a fuller-form variant) belongs to parseName, not this
  // part-level step — put it back so parseName sees it.
  const working = variant ? part.trim() : rest;
  let roles: Role[] = ['author'];
  if (markerRoles.length) roles = markerRoles;
  else if (defaultRoles.length) roles = defaultRoles;

  const segments = working.split(',').map((s) => s.trim()).filter(Boolean);
  // Only test the whole string against the organization word list when there's no comma to
  // segment on — with commas present, only a *trailing* segment gets peeled off as an org
  // below, so "Rutkowski, Hank, Air Conditioning Contractors of America" isn't swallowed
  // whole just because "Contractors" appears somewhere in it.
  if (segments.length <= 1) return [makeCredit(working, part, roles)];

  let trailingOrg: ParsedCredit | null = null;
  if (isOrganization(segments.at(-1)!)) {
    trailingOrg = makeCredit(segments.pop()!, part, roles);
  }

  const out = creditsFromSegments(segments, part, roles);
  if (trailingOrg) out.push(trailingOrg);
  return out;
}

function creditKey(c: ParsedCredit): string {
  if (!c.parts) return `junk:${c.raw}`;
  if (c.parts.kind === 'organization') return `org:${c.parts.matchKey}`;
  return `person:${c.parts.matchKey}`;
}

function dedupeCredits(credits: ParsedCredit[]): ParsedCredit[] {
  const out: ParsedCredit[] = [];
  for (const c of credits) {
    const key = creditKey(c);
    if (!c.rejected && out.some((o) => !o.rejected && creditKey(o) === key)) continue;
    out.push(c);
  }
  return out;
}

// Strips trailing characters from the given set. Linear, unlike /[.,;]+$/.
function stripTrailing(text: string, chars: string): string {
  let end = text.length;
  while (end > 0 && chars.includes(text[end - 1])) end--;
  return text.slice(0, end);
}

// Drops "[...]" runs (Calibre sort hints); an unclosed "[" is kept. Linear, unlike /\[[^\]]*\]/g.
function removeBracketed(s: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const open = s.indexOf('[', i);
    const close = open < 0 ? -1 : s.indexOf(']', open + 1);
    if (close < 0) return out + s.slice(i);
    out += s.slice(i, open);
    i = close + 1;
  }
}

export function splitNames(raw: string): ParsedCredit[] {
  let cleaned = removeBracketed(raw)
    .replaceAll('_', '.')
    .replaceAll('†', '')
    .trim();
  if (cleaned.length >= 2 && (cleaned.startsWith('"') || cleaned.startsWith("'")) && cleaned.at(-1) === cleaned[0]) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  let phraseRoles: Role[] = [];
  for (const [pattern, roles] of LEADING_ROLE_PHRASES) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, '').trim();
      phraseRoles = roles;
      break;
    }
  }

  let parts: string[];
  if (cleaned.includes(';')) {
    parts = cleaned.split(';');
  } else if (isOrganization(cleaned)) {
    parts = [cleaned];
  } else {
    parts = cleaned.split(/&|\s(?:and|with)\s/i);
  }
  parts = parts.map((p) => p.trim()).filter(Boolean);

  const credits = parts.flatMap((part) => processPart(part, phraseRoles));
  return dedupeCredits(credits);
}

// ---------------------------------------------------------------------------
// compareGiven() — name-compatibility check (§6.3 matching, point 3)
// ---------------------------------------------------------------------------

export type GivenCompatibility = 'exact' | 'full' | 'initials' | 'incompatible';

function tokenizeGiven(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(/[\s.-]+/).map(fold).filter(Boolean);
}

export function compareGiven(a: string | null | undefined, b: string | null | undefined): GivenCompatibility {
  const ta = tokenizeGiven(a);
  const tb = tokenizeGiven(b);
  if (ta.length === 0 || tb.length === 0) return 'initials';

  let sawInitialMatch = false;
  const len = Math.min(ta.length, tb.length);
  for (let i = 0; i < len; i++) {
    const x = ta[i];
    const y = tb[i];
    if (x === y) continue;
    const xInit = x.length === 1;
    const yInit = y.length === 1;
    if ((xInit && y.startsWith(x)) || (yInit && x.startsWith(y))) {
      sawInitialMatch = true;
      continue;
    }
    return 'incompatible';
  }
  if (ta.length === tb.length && !sawInitialMatch) return 'exact';
  return sawInitialMatch ? 'initials' : 'full';
}

export interface ImportedCandidate {
  contributor_id: string;
  display_name: string;
  match_key: string;
  kind: string;
  given_names: string | null;
  birth_year: number | null;
  identifiers: Record<string, string>;
  coauthor_keys: string[];
  affiliations: string[];
  work_ids: string[];
}

export function chooseImportedContributor(
  incoming: { kind: 'person' | 'organization'; givenNames?: string; identifiers?: Record<string, string>; coauthorKeys?: string[]; affiliation?: string; workId?: string; publicationYear?: number },
  candidates: ImportedCandidate[],
): { id: string; resolvedBy: 'identifier' | 'match' } | { id: null; provisional: boolean } {
  const viable = candidates.filter((candidate) => candidate.kind === incoming.kind &&
    !Object.entries(incoming.identifiers ?? {}).some(([scheme, value]) => candidate.identifiers[scheme] && candidate.identifiers[scheme] !== value) &&
    !(incoming.publicationYear && candidate.birth_year && candidate.birth_year > incoming.publicationYear));
  const byId = viable.filter((candidate) => Object.entries(incoming.identifiers ?? {}).some(([scheme, value]) => candidate.identifiers[scheme] === value));
  if (byId.length === 1) return { id: byId[0].contributor_id, resolvedBy: 'identifier' };
  const scored = viable.map((candidate) => {
    const compatibility = incoming.kind === 'organization' ? 'exact' : compareGiven(candidate.given_names, incoming.givenNames);
    const shared = candidate.coauthor_keys.filter((key) => incoming.coauthorKeys?.includes(key)).length;
    const affiliation = incoming.affiliation && candidate.affiliations.some((a) => fold(a) === fold(incoming.affiliation!));
    const compatibilityScore = compatibility === 'exact' ? 3 : Number(compatibility === 'full') + 1;
    return { candidate, compatibility, score: compatibilityScore +
      (incoming.workId && candidate.work_ids.includes(incoming.workId) ? 4 : 0) + Math.min(shared, 2) * 2 + (affiliation ? 2 : 0) };
  }).filter((x) => x.compatibility !== 'incompatible').sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return { id: null, provisional: false };
  if ((scored.length === 1 && (best.compatibility === 'exact' || best.compatibility === 'full')) ||
    (best.score >= 5 && best.score >= (scored[1]?.score ?? 0) + 2)) return { id: best.candidate.contributor_id, resolvedBy: 'match' };
  return { id: null, provisional: true };
}

import { parseAuthorityIdentifier, type AuthorityScheme } from 'shared/identifier';
import { chooseImportedContributor, fold, isJunk, parseName, type ImportedCandidate } from 'shared/names';
import { queueCover, type NormalizedMetadata } from '@/lib/functions';
import { supabase } from '@/lib/supabase';

// The logic behind "Look up metadata" (§9.2): loading match candidates for the incoming
// contributors, and applying the fields, credits and cover the user selected. The component owns
// the state and the rendering; nothing here touches React.
export const WORK_FIELDS = ['title', 'subtitle', 'abstract', 'language', 'work_type'] as const;
export const RECORD_FIELDS = ['publication_date', 'publisher', 'container_title', 'volume', 'issue_number', 'pages'] as const;
export type Field = (typeof WORK_FIELDS)[number] | (typeof RECORD_FIELDS)[number];
export type Person = NonNullable<NormalizedMetadata['contributors']>[number];
export type Match = ReturnType<typeof chooseImportedContributor>;

export const isWorkField = (field: string) => (WORK_FIELDS as readonly string[]).includes(field);

export function meta(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function locks(value: unknown): string[] {
  const raw = meta(value).locked_fields;
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

const AUTHORITY_SCHEMES = new Set<string>(['orcid', 'isni', 'viaf', 'wikidata', 'openlibrary', 'semantic_scholar']);

// Keeps only authority identifiers that validate (§6.2); anything else from a provider is dropped.
export function validIds(value: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value ?? {}).flatMap(([scheme, raw]) => {
      if (!AUTHORITY_SCHEMES.has(scheme)) return [];
      const normalized = parseAuthorityIdentifier(scheme as AuthorityScheme, raw);
      return normalized ? [[scheme, normalized]] : [];
    }),
  );
}

function personParts(person: Person) {
  const parts = parseName(person.name).parts;
  return parts?.kind === 'person' ? parts : null;
}

export const personKey = (person: Person) => fold(person.family ?? personParts(person)?.familyName ?? person.name);
export const isInvalidPerson = (person: Person) => isJunk(person.name) || (!person.family && !parseName(person.name).parts);

// Fields and credits ticked by default: everything the provider returned that is not locked.
export function defaultSelection(data: NormalizedMetadata, workLocks: string[], recordLocks: string[]) {
  const fields: Field[] = [...WORK_FIELDS, ...RECORD_FIELDS].filter((field) => !!data[field] && !(isWorkField(field) ? workLocks : recordLocks).includes(field));
  const credits = recordLocks.includes('contributors') ? [] : (data.contributors ?? []).flatMap((person, i) => (isInvalidPerson(person) ? [] : [i]));
  return { fields, credits };
}

// ---------- Match candidates ----------

async function candidateByIdentifier(scheme: string, value: string): Promise<ImportedCandidate | null> {
  const { data: linked, error } = await supabase.from('contributor_identifiers').select('contributor_id').eq('scheme', scheme).eq('value', value).maybeSingle();
  if (error) throw error;
  if (!linked) return null;
  const { data: c, error: contributorError } = await supabase.from('contributors').select('id,kind,display_name,given_names,match_key,birth_year').eq('id', linked.contributor_id).single();
  if (contributorError) throw contributorError;
  return { contributor_id: c.id, kind: c.kind, display_name: c.display_name, given_names: c.given_names, match_key: c.match_key, birth_year: c.birth_year, identifiers: { [scheme]: value }, coauthor_keys: [], affiliations: [], work_ids: [] };
}

// contributor_candidates() by name key, plus contributors already linked to an incoming authority ID.
export async function loadCandidates(data: NormalizedMetadata): Promise<ImportedCandidate[]> {
  const people = data.contributors ?? [];
  const { data: found, error } = await supabase.rpc('contributor_candidates', { p_match_keys: people.map(personKey) });
  if (error) throw error;
  const matches: ImportedCandidate[] = [
    ...new Map((found ?? []).map((c) => [c.contributor_id, { ...c, identifiers: meta(c.identifiers) as Record<string, string>, coauthor_keys: c.coauthor_keys ?? [], affiliations: c.affiliations ?? [], work_ids: c.work_ids ?? [] }])).values(),
  ];
  for (const person of people) {
    for (const [scheme, value] of Object.entries(validIds(person.identifiers))) {
      const candidate = await candidateByIdentifier(scheme, value);
      if (candidate && !matches.some((c) => c.contributor_id === candidate.contributor_id)) matches.push(candidate);
    }
  }
  return matches;
}

export function suggestContributor(person: Person, ctx: { people: Person[]; candidates: ImportedCandidate[]; workId: string; publicationDate?: string }): Match {
  const parts = personParts(person);
  const family = person.family ?? parts?.familyName ?? person.name;
  const kind = parseName(person.name).parts?.kind === 'organization' ? 'organization' : 'person';
  const identifiers = validIds(person.identifiers);
  const relevant = ctx.candidates.filter((c) => c.kind === kind && (c.match_key === fold(family) || Object.entries(identifiers).some(([scheme, value]) => c.identifiers[scheme] === value)));
  return chooseImportedContributor(
    {
      kind,
      givenNames: person.given ?? parts?.givenNames ?? undefined,
      identifiers,
      coauthorKeys: ctx.people.filter((other) => other !== person).map(personKey),
      affiliation: person.affiliation,
      workId: ctx.workId,
      publicationYear: ctx.publicationDate ? Number(ctx.publicationDate.slice(0, 4)) : undefined,
    },
    relevant,
  );
}

// ---------- Applying ----------

export interface ApplyInput {
  data: NormalizedMetadata;
  fetchedAt: string;
  selected: Field[];
  selectedCredits: number[];
  includeCover: boolean;
  overrides: Record<number, string>;
  workId: string;
  recordId: string;
  workLocks: string[];
  recordLocks: string[];
  candidates: ImportedCandidate[];
  suggest: (person: Person) => Match;
}

function buildPatches({ data, selected, workLocks, recordLocks }: ApplyInput) {
  const workPatch: Record<string, unknown> = {};
  const recordPatch: Record<string, unknown> = {};
  for (const field of selected) {
    const isWork = isWorkField(field);
    if ((isWork ? workLocks : recordLocks).includes(field)) continue;
    const value = data[field];
    if (value) (isWork ? workPatch : recordPatch)[field] = value;
  }
  if (selected.includes('publication_date') && data.publication_date_precision && !recordLocks.includes('publication_date')) {
    recordPatch.publication_date_precision = data.publication_date_precision;
  }
  return { workPatch, recordPatch };
}

// Which contributor a credit points at: the user's choice in the match dropdown, else the suggestion.
function chooseExisting(override: string | undefined, match: Match): { id: string | null; resolvedBy: string } {
  if (override === 'new') return { id: null, resolvedBy: 'new' };
  if (override) return { id: override, resolvedBy: 'user' };
  if (match.id) return { id: match.id, resolvedBy: match.resolvedBy };
  return { id: null, resolvedBy: 'new' };
}

async function createContributor(userId: string, person: Person, provisional: boolean): Promise<string> {
  const parts = personParts(person);
  const family = person.family ?? parts?.familyName ?? null;
  const given = person.given ?? parts?.givenNames ?? null;
  const givenSuffix = given ? `, ${given}` : '';
  const { data: created, error } = await supabase
    .from('contributors')
    .insert({
      user_id: userId,
      kind: parseName(person.name).parts?.kind === 'organization' ? 'organization' : 'person',
      display_name: person.name,
      family_name: family,
      given_names: given,
      sort_name: family ? `${family}${givenSuffix}` : person.name,
      match_key: fold(family ?? person.name),
      status: provisional ? 'provisional' : 'confirmed',
    })
    .select('id')
    .single();
  if (error) throw error;
  return created.id;
}

async function linkIdentifiers(userId: string, contributorId: string, person: Person) {
  for (const [scheme, value] of Object.entries(validIds(person.identifiers))) {
    const { data: existing, error } = await supabase.from('contributor_identifiers').select('contributor_id').eq('scheme', scheme).eq('value', value).maybeSingle();
    if (error) throw error;
    if (existing && existing.contributor_id !== contributorId) throw new Error(`${scheme} belongs to another contributor.`);
    if (!existing) {
      const { error: insertError } = await supabase.from('contributor_identifiers').insert({ user_id: userId, contributor_id: contributorId, scheme, value });
      if (insertError) throw insertError;
    }
  }
}

async function resolveCredit(userId: string, person: Person, index: number, input: ApplyInput) {
  const match = input.suggest(person);
  const override = input.overrides[index];
  let { id: contributorId, resolvedBy } = chooseExisting(override, match);
  if (!contributorId) {
    const provisional = override !== 'new' && 'provisional' in match && match.provisional;
    contributorId = await createContributor(userId, person, provisional);
    resolvedBy = 'new';
  }
  await linkIdentifiers(userId, contributorId, person);
  const knownName = input.candidates.find((c) => c.contributor_id === contributorId)?.display_name;
  if (person.name && match.id && person.name !== knownName) {
    const family = person.family ?? personParts(person)?.familyName ?? null;
    await supabase.from('contributor_names').upsert({ user_id: userId, contributor_id: contributorId, name: person.name, match_key: fold(family ?? person.name), name_type: 'variant' }, { onConflict: 'contributor_id,name' });
  }
  return { contributorId, resolvedBy };
}

async function applyContributors(input: ApplyInput) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Sign in again.');
  const credits: { contributor_id: string; role: string; position: number; credited_as: string | null; affiliation: string | null; resolved_by: string }[] = [];
  const positions = new Map<string, number>();
  for (const index of input.selectedCredits) {
    const person = input.data.contributors?.[index];
    if (!person) continue;
    const { contributorId, resolvedBy } = await resolveCredit(auth.user.id, person, index, input);
    const position = positions.get(person.role) ?? 0;
    positions.set(person.role, position + 1);
    credits.push({ contributor_id: contributorId, role: person.role, position, credited_as: person.name, affiliation: person.affiliation ?? null, resolved_by: resolvedBy });
  }
  const { error } = await supabase.rpc('set_record_contributors', { p_record_id: input.recordId, p_credits: credits });
  if (error) throw error;
}

export async function applyMetadata(input: ApplyInput) {
  const { data, selectedCredits, includeCover, recordId, workId } = input;
  const { workPatch, recordPatch } = buildPatches(input);
  if (Object.keys(workPatch).length) {
    const { error } = await supabase.from('works').update(workPatch as never).eq('id', workId);
    if (error) throw error;
  }
  if (Object.keys(workPatch).length || Object.keys(recordPatch).length || selectedCredits.length || includeCover) {
    if ('container_title' in recordPatch) {
      const { data: current, error: readError } = await supabase.from('records').select('metadata').eq('id', recordId).single();
      if (readError) throw readError;
      const metadata = meta(current.metadata);
      if (!locks(metadata).includes('container_title')) {
        recordPatch.metadata = { ...metadata, container_title: recordPatch.container_title };
      }
      delete recordPatch.container_title;
    }
    recordPatch.metadata_source = data.source_provider;
    recordPatch.metadata_fetched_at = input.fetchedAt;
    const { error } = await supabase.from('records').update(recordPatch as never).eq('id', recordId);
    if (error) throw error;
  }
  if (selectedCredits.length) await applyContributors(input);
  if (includeCover && data.cover_url) await queueCover(recordId, data.cover_url);
}

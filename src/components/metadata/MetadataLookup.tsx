import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { parseAuthorityIdentifier, parseIdentifier, type AuthorityScheme, type IdentifierScheme } from 'shared/identifier';
import { chooseImportedContributor, fold, isJunk, parseName, type ImportedCandidate } from 'shared/names';
import { metadataLookup, queueCover, type NormalizedMetadata, type MetadataResponse } from '@/lib/functions';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Work = { id: string; title: string; subtitle: string | null; abstract: string | null; language: string | null; work_type: string; metadata: unknown };
type RecordValue = { id: string; title: string | null; publication_date: string | null; publication_date_precision: string | null; publisher: string | null; volume: string | null; issue_number: string | null; pages: string | null; metadata: unknown; record_contributors: { contributor_id: string; role: string; position: number; credited_as: string | null }[]; record_assets: { assets: { metadata: unknown } | null }[] };
const WORK_FIELDS = ['title', 'subtitle', 'abstract', 'language', 'work_type'] as const;
const RECORD_FIELDS = ['publication_date', 'publisher', 'volume', 'issue_number', 'pages'] as const;
type Field = (typeof WORK_FIELDS)[number] | (typeof RECORD_FIELDS)[number];
const SCHEMES: IdentifierScheme[] = ['isbn', 'doi', 'arxiv', 'pmid', 'issn'];
function meta(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function locks(value: unknown): string[] { const raw = meta(value).locked_fields; return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []; }
const AUTHORITY_SCHEMES = new Set<string>(['orcid', 'isni', 'viaf', 'wikidata', 'openlibrary', 'semantic_scholar']);
function validIds(value: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(value ?? {}).flatMap(([scheme, raw]) => {
    if (!AUTHORITY_SCHEMES.has(scheme)) return [];
    const normalized = parseAuthorityIdentifier(scheme as AuthorityScheme, raw);
    return normalized ? [[scheme, normalized]] : [];
  }));
}

export function MetadataLookup({ work, record }: Readonly<{ work: Work; record: RecordValue }>) {
  const query = useQueryClient();
  const [scheme, setScheme] = useState<IdentifierScheme>('isbn');
  const [value, setValue] = useState('');
  const [response, setResponse] = useState<MetadataResponse | null>(null);
  const [selected, setSelected] = useState<Field[]>([]);
  const [selectedCredits, setSelectedCredits] = useState<number[]>([]);
  const [includeCover, setIncludeCover] = useState(false);
  const [candidates, setCandidates] = useState<ImportedCandidate[]>([]);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const data = response?.status === 'success' ? response.data : null;
  const workLocks = locks(work.metadata);
  const recordLocks = locks(record.metadata);

  async function lookup() {
    setError(''); setDone(''); setResponse(null);
    const parsed = parseIdentifier(scheme, value);
    if (!parsed.ok) { setError(parsed.reason === 'invalid_check_digit' ? 'Invalid check digit.' : `Invalid ${scheme.toUpperCase()} format.`); return; }
    setPending(true);
    try {
      const result = await metadataLookup(scheme, value);
      setResponse(result);
      if (result.status === 'success') {
        setSelected([...WORK_FIELDS, ...RECORD_FIELDS].filter((field) => !!result.data[field] && !((WORK_FIELDS as readonly string[]).includes(field) ? workLocks : recordLocks).includes(field)) as Field[]);
        setSelectedCredits(recordLocks.includes('contributors') ? [] : (result.data.contributors ?? []).flatMap((person, i) => isJunk(person.name) || (!person.family && !parseName(person.name).parts) ? [] : [i]));
        setIncludeCover(!!result.data.cover_url);
        const keys = (result.data.contributors ?? []).map((person) => { const parts = parseName(person.name).parts; return fold(person.family ?? (parts?.kind === 'person' ? parts.familyName : person.name)); });
        const { data: found, error: candidateError } = await supabase.rpc('contributor_candidates', { p_match_keys: keys });
        if (candidateError) throw candidateError;
        const matches: ImportedCandidate[] = [...new Map((found ?? []).map((c) => [c.contributor_id, { ...c, identifiers: meta(c.identifiers) as Record<string, string>, coauthor_keys: c.coauthor_keys ?? [], affiliations: c.affiliations ?? [], work_ids: c.work_ids ?? [] }])).values()];
        for (const person of result.data.contributors ?? []) {
          for (const [idScheme, idValue] of Object.entries(validIds(person.identifiers))) {
            const { data: linked, error: idError } = await supabase.from('contributor_identifiers').select('contributor_id').eq('scheme', idScheme).eq('value', idValue).maybeSingle();
            if (idError) throw idError;
            if (linked && !matches.some((c) => c.contributor_id === linked.contributor_id)) {
              const { data: contributor, error: contributorError } = await supabase.from('contributors').select('id,kind,display_name,given_names,match_key,birth_year').eq('id', linked.contributor_id).single();
              if (contributorError) throw contributorError;
              matches.push({ contributor_id: contributor.id, kind: contributor.kind, display_name: contributor.display_name, given_names: contributor.given_names, match_key: contributor.match_key, birth_year: contributor.birth_year, identifiers: { [idScheme]: idValue }, coauthor_keys: [], affiliations: [], work_ids: [] });
            }
          }
        }
        setCandidates(matches);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Lookup failed.'); }
    finally { setPending(false); }
  }

  function suggestion(person: NonNullable<NormalizedMetadata['contributors']>[number]) {
    const parsed = parseName(person.name);
    const family = person.family ?? (parsed.parts?.kind === 'person' ? parsed.parts.familyName : person.name);
    const kind = parsed.parts?.kind === 'organization' ? 'organization' : 'person';
    const coauthorKeys = (data?.contributors ?? []).filter((other) => other !== person).map((other) => { const parts = parseName(other.name).parts; return fold(other.family ?? (parts?.kind === 'person' ? parts.familyName : other.name)); });
    const identifiers = validIds(person.identifiers);
    return chooseImportedContributor({ kind, givenNames: person.given ?? (parsed.parts?.kind === 'person' ? parsed.parts.givenNames ?? undefined : undefined), identifiers, coauthorKeys, affiliation: person.affiliation, workId: work.id, publicationYear: data?.publication_date ? Number(data.publication_date.slice(0, 4)) : undefined }, candidates.filter((c) => c.kind === kind && (c.match_key === fold(family) || Object.entries(identifiers).some(([idScheme, idValue]) => c.identifiers[idScheme] === idValue))));
  }

  async function apply() {
    if (!data) return;
    setError(''); setDone(''); setPending(true);
    try {
      const fetchedAt = response?.status === 'success' ? response.fetchedAt : new Date().toISOString();
      const workPatch: Record<string, unknown> = {};
      const recordPatch: Record<string, unknown> = {};
      for (const field of selected) {
        const isWork = (WORK_FIELDS as readonly string[]).includes(field);
        if ((isWork ? workLocks : recordLocks).includes(field)) continue;
        const value = data[field];
        if (value) (isWork ? workPatch : recordPatch)[field] = value;
      }
      if (selected.includes('publication_date') && data.publication_date_precision && !recordLocks.includes('publication_date')) recordPatch.publication_date_precision = data.publication_date_precision;
      if (Object.keys(workPatch).length) {
        const { error: updateError } = await supabase.from('works').update(workPatch as never).eq('id', work.id);
        if (updateError) throw updateError;
      }
      if (Object.keys(workPatch).length || Object.keys(recordPatch).length || selectedCredits.length || includeCover) {
        recordPatch.metadata_source = data.source_provider;
        recordPatch.metadata_fetched_at = fetchedAt;
        const { error: updateError } = await supabase.from('records').update(recordPatch as never).eq('id', record.id);
        if (updateError) throw updateError;
      }
      if (selectedCredits.length) {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) throw new Error('Sign in again.');
        const credits: { contributor_id: string; role: string; position: number; credited_as: string | null; affiliation: string | null; resolved_by: string }[] = [];
        const positions = new Map<string, number>();
        for (const index of selectedCredits) {
          const person = data.contributors?.[index];
          if (!person) continue;
          const parsed = parseName(person.name);
          const parts = parsed.parts;
          const family = person.family ?? (parts?.kind === 'person' ? parts.familyName : null);
          const given = person.given ?? (parts?.kind === 'person' ? parts.givenNames : null);
          const match = suggestion(person);
          const override = overrides[index];
          let contributorId = override === 'new' ? null : override || match.id;
          let resolvedBy = override && override !== 'new' ? 'user' : match.id && override !== 'new' ? match.resolvedBy : 'new';
          if (!contributorId) {
            const provisional = override === 'new' ? false : 'provisional' in match && match.provisional;
            const { data: created, error: createError } = await supabase.from('contributors').insert({ user_id: auth.user.id, kind: parts?.kind === 'organization' ? 'organization' : 'person', display_name: person.name, family_name: family, given_names: given, sort_name: family ? `${family}${given ? `, ${given}` : ''}` : person.name, match_key: fold(family ?? person.name), status: provisional ? 'provisional' : 'confirmed' }).select('id').single();
            if (createError) throw createError;
            contributorId = created.id;
            resolvedBy = 'new';
          }
          for (const [idScheme, idValue] of Object.entries(validIds(person.identifiers))) {
            const { data: existingId, error: lookupError } = await supabase.from('contributor_identifiers').select('contributor_id').eq('scheme', idScheme).eq('value', idValue).maybeSingle();
            if (lookupError) throw lookupError;
            if (existingId && existingId.contributor_id !== contributorId) throw new Error(`${idScheme} belongs to another contributor.`);
            if (!existingId) {
              const { error: idError } = await supabase.from('contributor_identifiers').insert({ user_id: auth.user.id, contributor_id: contributorId, scheme: idScheme, value: idValue });
              if (idError) throw idError;
            }
          }
          if (person.name && match.id && person.name !== candidates.find((c) => c.contributor_id === contributorId)?.display_name) {
            await supabase.from('contributor_names').upsert({ user_id: auth.user.id, contributor_id: contributorId, name: person.name, match_key: fold(family ?? person.name), name_type: 'variant' }, { onConflict: 'contributor_id,name' });
          }
          const position = positions.get(person.role) ?? 0;
          positions.set(person.role, position + 1);
          credits.push({ contributor_id: contributorId, role: person.role, position, credited_as: person.name, affiliation: person.affiliation ?? null, resolved_by: resolvedBy });
        }
        const { error: creditError } = await supabase.rpc('set_record_contributors', { p_record_id: record.id, p_credits: credits });
        if (creditError) throw creditError;
      }
      if (includeCover && data.cover_url) await queueCover(record.id, data.cover_url);
      await query.invalidateQueries({ queryKey: ['works'] });
      setDone('Metadata applied.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not apply metadata.'); }
    finally { setPending(false); }
  }

  async function unlock(field: string, isWork: boolean) {
    const current = meta(isWork ? work.metadata : record.metadata);
    const updated = { ...current, locked_fields: locks(current).filter((name) => name !== field) };
    const { error } = isWork ? await supabase.from('works').update({ metadata: updated } as never).eq('id', work.id) : await supabase.from('records').update({ metadata: updated }).eq('id', record.id);
    if (error) { setError(error.message); return; }
    await query.invalidateQueries({ queryKey: ['works', work.id] });
  }

  return <section className="flex flex-col gap-2 rounded-8 border border-border p-3" aria-label="Metadata lookup">
    <p className="text-label text-fg">Look up metadata</p>
    <div className="flex flex-wrap gap-2">
      <select value={scheme} onChange={(e) => setScheme(e.target.value as IdentifierScheme)} aria-label="Identifier scheme" className="rounded-8 border border-muted bg-dim p-2 text-fg">{SCHEMES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}</select>
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Identifier" className="w-auto min-w-[190px] flex-1" />
      <Button onClick={lookup} isLoading={pending} disabled={!value.trim()}>Look up</Button>
    </div>
    {response?.status === 'not_found' && <p className="text-small text-yellow">No metadata found in {response.searchedProviders.join(', ')}.</p>}
    {response?.status === 'rate_limited' && <p className="text-small text-yellow">{response.provider} is rate limited. Try again later.</p>}
    {response?.status === 'provider_error' && <p className="text-small text-red">{response.provider} could not return metadata: {response.message}</p>}
    {response?.status === 'invalid_identifier' && <p className="text-small text-red">Invalid identifier: {response.reason}</p>}
    {record.record_assets.flatMap(({ assets }) => { const suggestions = meta(assets?.metadata).identifier_suggestions; return Array.isArray(suggestions) ? suggestions : []; }).map((item, index) => { const suggestion = meta(item); return typeof suggestion.scheme === 'string' && typeof suggestion.value === 'string' ? <button key={index} type="button" className="text-left text-small text-green underline" onClick={() => { setScheme(suggestion.scheme as IdentifierScheme); setValue(suggestion.value as string); }}>Found in file: {suggestion.scheme.toUpperCase()} {suggestion.value}</button> : null; })}
    {record.record_assets.flatMap(({ assets }) => { const author = meta(assets?.metadata).author_suggestion; return typeof author === 'string' && author.trim() ? [author] : []; }).map((author, index) => <p key={index} className="text-small text-muted">File author suggestion: {author}</p>)}
    {data && <div className="flex flex-col gap-2">
      <p className="text-small text-muted">From {data.source_provider}{response?.status === 'success' && response.fromCache ? ' · cached' : ''}. Choose fields to apply.</p>
      {data.role_warning && <p className="text-small text-yellow">{data.role_warning}</p>}
      {[...WORK_FIELDS, ...RECORD_FIELDS].filter((field) => data[field]).map((field) => {
        const isWork = (WORK_FIELDS as readonly string[]).includes(field);
        const locked = (isWork ? workLocks : recordLocks).includes(field);
        const current = isWork ? work[field as keyof Work] : record[field as keyof RecordValue];
        return <div key={field} className="flex items-start gap-2 text-small text-fg"><label><input type="checkbox" checked={selected.includes(field)} disabled={locked} onChange={(e) => setSelected((prev) => e.target.checked ? [...prev, field] : prev.filter((f) => f !== field))} /> {field.replaceAll('_', ' ')}: {String(current ?? '—')} → {data[field]}{locked ? ' (locked)' : ''}</label>{locked && <button type="button" className="text-green underline" onClick={() => unlock(field, isWork)}>Unlock</button>}</div>;
      })}
      {recordLocks.includes('contributors') && <button type="button" className="text-left text-small text-green underline" onClick={() => unlock('contributors', false)}>Contributor credits locked by manual edit. Unlock credits</button>}
      {(data.contributors ?? []).map((person, index) => { const match = suggestion(person); const invalid = isJunk(person.name) || (!person.family && !parseName(person.name).parts); return <div key={`${person.name}:${index}`} className="flex items-center gap-2 text-small text-fg"><input type="checkbox" aria-label={`Include ${person.name}`} checked={selectedCredits.includes(index)} disabled={recordLocks.includes('contributors') || invalid} onChange={(e) => setSelectedCredits((prev) => e.target.checked ? [...prev, index] : prev.filter((n) => n !== index))} /><span>{person.role}: {person.name}{invalid ? ' (invalid name)' : ''}</span><select aria-label={`Match for ${person.name}`} className="rounded-8 border border-muted bg-dim p-1 text-fg" value={overrides[index] ?? (match.id ?? 'new')} onChange={(e) => setOverrides((prev) => ({ ...prev, [index]: e.target.value }))}><option value="new">{'provisional' in match && match.provisional ? 'Possibly existing — review' : 'New contributor'}</option>{candidates.map((candidate) => <option key={candidate.contributor_id} value={candidate.contributor_id}>{candidate.display_name ?? candidate.contributor_id}</option>)}</select></div>; })}
      {data.cover_url && <label className="text-small text-fg"><input type="checkbox" checked={includeCover} onChange={(e) => setIncludeCover(e.target.checked)} /> Retrieve cover</label>}
      <Button onClick={apply} isLoading={pending} disabled={!selected.length && !selectedCredits.length && !includeCover}>Apply selected metadata</Button>
    </div>}
    {error && <p className="text-small text-red" role="alert">{error}</p>}
    {done && <output className="text-small text-green">{done}</output>}
  </section>;
}

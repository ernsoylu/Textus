import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IDENTIFIER_SCHEMES, STANDARD_SCHEMES, parseIdentifier, type IdentifierScheme } from 'shared/identifier';
import type { ImportedCandidate } from 'shared/names';
import { titleMetadataSearch, metadataLookup, type MetadataResponse, type NormalizedMetadata } from '@/lib/functions';
import { applyMetadata, defaultSelection, isInvalidPerson, isWorkField, loadCandidates, locks, meta, suggestContributor, RECORD_FIELDS, WORK_FIELDS, type Field, type Person } from '@/lib/metadataApply';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addIdentifier } from '@/hooks/useCatalogMutations';
import { MetadataProgress } from './MetadataProgress';

type Work = { id: string; title: string; subtitle: string | null; abstract: string | null; language: string | null; work_type: string; metadata: unknown };
type RecordValue = { id: string; title: string | null; publication_date: string | null; publication_date_precision: string | null; publisher: string | null; edition?: string | null; volume: string | null; issue_number: string | null; pages: string | null; metadata: unknown; identifiers?: { scheme: string; normalized_value: string }[]; record_contributors: { contributor_id: string; role: string; position: number; credited_as: string | null }[]; record_assets: { assets: { metadata: unknown } | null }[] };
const displayValue = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '—');

export function MetadataLookup({ work, record, defaultScheme = 'isbn' }: Readonly<{ work: Work; record: RecordValue; defaultScheme?: IdentifierScheme }>) {
  const query = useQueryClient();
  const [searchTitle, setSearchTitle] = useState(work.title);
  const [searchAuthor, setSearchAuthor] = useState('');
  const [externalConsent, setExternalConsent] = useState(false);
  const titleSearch = useMutation({ mutationFn: () => titleMetadataSearch(record.id, searchTitle, searchAuthor) });
  const [scheme, setScheme] = useState<IdentifierScheme>(defaultScheme);
  useEffect(() => setScheme(defaultScheme), [defaultScheme]);
  const [value, setValue] = useState(() => record.identifiers?.find((id) => id.scheme === defaultScheme)?.normalized_value ?? '');
  const saveIdentifier = useMutation({
    mutationFn: () => addIdentifier(record.id, scheme, value),
    onSuccess: ({ duplicateCount }) => {
      setDone(duplicateCount ? 'Identifier saved. Another record in your library has this identifier.' : 'Identifier saved.');
      query.invalidateQueries({ queryKey: ['works'] });
    },
  });
  const [response, setResponse] = useState<MetadataResponse | null>(null);
  const [selected, setSelected] = useState<Field[]>([]);
  const [selectedCredits, setSelectedCredits] = useState<number[]>([]);
  const [includeCover, setIncludeCover] = useState(false);
  const [candidates, setCandidates] = useState<ImportedCandidate[]>([]);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [pending, setPending] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const data = response?.status === 'success' ? response.data : null;
  const workLocks = locks(work.metadata);
  const recordLocks = locks(record.metadata);

  async function lookup() {
    setError(''); setDone(''); setResponse(null);
    const parsed = parseIdentifier(scheme, value);
    if (!parsed.ok) { setError(parsed.reason === 'invalid_check_digit' ? 'Invalid check digit.' : (STANDARD_SCHEMES as readonly string[]).includes(scheme) ? 'Enter the standard reference with its edition year, such as ISO/PAS 20065:2016(E).' : `Invalid ${scheme.toUpperCase()} format.`); return; }
    setPending(true);
    setProgressMessage(`Searching ${scheme.toUpperCase()} ${parsed.normalized}…`);
    try {
      const result = await metadataLookup(scheme, value, scheme === 'isbn');
      setResponse(result);
      if (result.status === 'success') {
        const selection = defaultSelection(result.data, workLocks, recordLocks);
        setSelected(selection.fields);
        setSelectedCredits(selection.credits);
        setIncludeCover(!!result.data.cover_url);
        setCandidates(await loadCandidates(result.data));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Lookup failed.'); }
    finally { setPending(false); }
  }

  function suggestion(person: Person) {
    return suggestContributor(person, { people: data?.contributors ?? [], candidates, workId: work.id, publicationDate: data?.publication_date });
  }

  async function apply() {
    if (!data) return;
    setError(''); setDone(''); setPending(true);
    setProgressMessage('Applying metadata…');
    try {
      const fetchedAt = response?.status === 'success' ? response.fetchedAt : new Date().toISOString();
      await applyMetadata({ data, fetchedAt, selected, selectedCredits, includeCover, overrides, workId: work.id, recordId: record.id, workLocks, recordLocks, candidates, suggest: suggestion });
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
    <p className="text-label text-fg">Identifiers & metadata</p>
    <div className="flex flex-wrap gap-2">
      <select value={scheme} onChange={(e) => { setScheme(e.target.value as IdentifierScheme); setValue(record.identifiers?.find((id) => id.scheme === e.target.value)?.normalized_value ?? ''); saveIdentifier.reset(); setDone(''); }} aria-label="Identifier scheme" className="rounded-8 border border-muted bg-dim p-2 text-fg">{IDENTIFIER_SCHEMES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}</select>
      <Input value={value} onChange={(e) => setValue(e.target.value)} aria-label="Lookup reference" placeholder={(STANDARD_SCHEMES as readonly string[]).includes(scheme) ? 'Reference number, including year' : 'Identifier'} className="w-auto min-w-[190px] flex-1" />
      <Button variant="secondary" onClick={() => { setDone(''); saveIdentifier.mutate(); }} isLoading={saveIdentifier.isPending} disabled={!value.trim() || pending}>Save identifier</Button>
      <Button onClick={lookup} isLoading={pending} disabled={!value.trim() || saveIdentifier.isPending}>Look up</Button>
    </div>
    <MetadataProgress message={pending ? progressMessage : undefined} />
    {response?.status === 'not_found' && <p className="text-small text-yellow">No metadata found in {response.searchedProviders.join(', ')}.</p>}
    {response?.status === 'rate_limited' && <p className="text-small text-yellow">{response.provider} is rate limited. Try again later.</p>}
    {response?.status === 'provider_error' && <p className="text-small text-red">{response.provider} could not return metadata: {response.message}</p>}
    {response?.status === 'invalid_identifier' && <p className="text-small text-red">Invalid identifier: {response.reason}</p>}
    {record.record_assets.flatMap(({ assets }) => { const suggestions = meta(assets?.metadata).identifier_suggestions; return Array.isArray(suggestions) ? suggestions : []; }).map((item) => meta(item)).filter((suggestion, index, all) => typeof suggestion.scheme === 'string' && typeof suggestion.value === 'string' && (suggestion.scheme !== 'isbn' || all.findIndex((candidate) => candidate.scheme === 'isbn') === index)).map((suggestion) => <button key={`${suggestion.scheme}:${suggestion.value}`} type="button" className="text-left text-small text-green underline" onClick={() => { setScheme(suggestion.scheme as IdentifierScheme); setValue(suggestion.value as string); }}>Found in file: {String(suggestion.scheme).toUpperCase()} {String(suggestion.value)}</button>)}
    {record.record_assets.flatMap(({ assets }) => { const author = meta(assets?.metadata).author_suggestion; return typeof author === 'string' && author.trim() ? [author] : []; }).map((author) => <p key={author} className="text-small text-muted">File author suggestion: {author}</p>)}
    {Object.entries(meta(meta(record.metadata).lookup_suggestions)).filter(([key]) => key.startsWith('llm:')).map(([key, raw]) => {
      const suggestion = meta(raw);
      const proposed = meta(suggestion.data);
      if (typeof proposed.title !== 'string' || typeof proposed.source_provider !== 'string') return null;
      return <Button key={key} variant="secondary" disabled={pending} onClick={async () => {
        setError(''); setDone(''); setPending(true);
        try {
          const proposal = proposed as unknown as NormalizedMetadata;
          setResponse({ status: 'success', data: proposal, fromCache: false, fetchedAt: typeof suggestion.fetched_at === 'string' ? suggestion.fetched_at : new Date().toISOString() });
          setSearchTitle(proposal.title ?? work.title); setSearchAuthor(proposal.contributors?.[0]?.name ?? '');
          setSelected([]); setSelectedCredits([]); setIncludeCover(false);
          setCandidates(await loadCandidates(proposal));
        } catch { setError('Could not prepare suggestion review.'); }
        finally { setPending(false); }
      }}>Review AI suggestion: {proposed.title}</Button>;
    })}
    <div className="flex flex-col gap-2 rounded-8 border border-border p-3">
      <p className="text-small text-muted">No identifier? Search public catalogs with a title and author. Only these two fields are sent to Open Library and Crossref.</p>
      <Input aria-label="Title for public catalog search" maxLength={200} value={searchTitle} onChange={(e) => setSearchTitle(e.target.value)} />
      <Input aria-label="Author for public catalog search" maxLength={200} value={searchAuthor} onChange={(e) => setSearchAuthor(e.target.value)} />
      <label className="text-small text-fg"><input type="checkbox" checked={externalConsent} onChange={(e) => setExternalConsent(e.target.checked)} /> Allow sending this title and author to these public catalogs</label>
      <Button variant="secondary" disabled={!externalConsent || !searchTitle.trim() || pending} isLoading={titleSearch.isPending} onClick={() => titleSearch.mutate()}>Search public catalogs</Button>
      {titleSearch.error && <p role="alert">Public catalog search failed. Try again later.</p>}
      {titleSearch.isSuccess && !titleSearch.data.candidates.length && <p role="status">No catalog candidates found.</p>}
      {titleSearch.data?.candidates.map((candidate, index) => <Button key={index} variant="ghost" disabled={pending} onClick={async () => {
        setPending(true); setError(''); setDone('');
        try {
          setResponse({ status: 'success', data: candidate.data, fromCache: false, fetchedAt: new Date().toISOString() });
          const selection = defaultSelection(candidate.data, workLocks, recordLocks);
          setSelected(selection.fields); setSelectedCredits(selection.credits); setIncludeCover(false);
          if (candidate.identifier) { setScheme(candidate.identifier.scheme); setValue(candidate.identifier.value); }
          setCandidates(await loadCandidates(candidate.data));
        } catch { setError('Could not prepare candidate review.'); }
        finally { setPending(false); }
      }}>Review {candidate.data.title} · {candidate.data.source_provider}</Button>)}
    </div>
    {data && <div className="flex flex-col gap-2">
      <p className="text-small text-muted">From {data.source_provider}{response?.status === 'success' && response.fromCache ? ' · cached' : ''}. Choose fields to apply.</p>
      {data.source_url?.startsWith('https://') && <a href={data.source_url} target="_blank" rel="noreferrer" className="text-small text-green underline">Open source catalogue</a>}
      {typeof (data as unknown as Record<string, unknown>).evidence === 'string' && <p className="text-small text-muted">Front matter evidence: {String((data as unknown as Record<string, unknown>).evidence)}</p>}
      {data.role_warning && <p className="text-small text-yellow">{data.role_warning}</p>}
      {[...WORK_FIELDS, ...RECORD_FIELDS].filter((field) => data[field]).map((field) => {
        const isWork = isWorkField(field);
        const locked = (isWork ? workLocks : recordLocks).includes(field);
        const current = field === 'container_title' || field === 'standard_status' ? meta(record.metadata)[field] : field === 'standard_reference' ? record.identifiers?.find((identifier) => identifier.scheme === data.standard_scheme)?.normalized_value : isWork ? work[field as keyof Work] : record[field as keyof RecordValue];
        return <div key={field} className="flex items-start gap-2 text-small text-fg"><label><input type="checkbox" checked={selected.includes(field)} disabled={locked} onChange={(e) => setSelected((prev) => e.target.checked ? [...prev, field] : prev.filter((f) => f !== field))} /> {field === 'container_title' ? 'Journal / container title' : field.replaceAll('_', ' ')}: {displayValue(current)} → {data[field]}{locked ? ' (locked)' : ''}</label>{locked && <button type="button" className="text-green underline" onClick={() => unlock(field, isWork)}>Unlock</button>}</div>;
      })}
      {recordLocks.includes('contributors') && <button type="button" className="text-left text-small text-green underline" onClick={() => unlock('contributors', false)}>Contributor credits locked by manual edit. Unlock credits</button>}
      {(data.contributors ?? []).map((person, index) => { const match = suggestion(person); const invalid = isInvalidPerson(person); return <div key={`${person.name}:${index}`} className="flex items-center gap-2 text-small text-fg"><input type="checkbox" aria-label={`Include ${person.name}`} checked={selectedCredits.includes(index)} disabled={recordLocks.includes('contributors') || invalid} onChange={(e) => setSelectedCredits((prev) => e.target.checked ? [...prev, index] : prev.filter((n) => n !== index))} /><span>{person.role}: {person.name}{invalid ? ' (invalid name)' : ''}</span><select aria-label={`Match for ${person.name}`} className="rounded-8 border border-muted bg-dim p-1 text-fg" value={overrides[index] ?? (match.id ?? 'new')} onChange={(e) => setOverrides((prev) => ({ ...prev, [index]: e.target.value }))}><option value="new">{'provisional' in match && match.provisional ? 'Possibly existing — review' : 'New contributor'}</option>{candidates.map((candidate) => <option key={candidate.contributor_id} value={candidate.contributor_id}>{candidate.display_name ?? candidate.contributor_id}</option>)}</select></div>; })}
      {data.cover_url && <label className="text-small text-fg"><input type="checkbox" checked={includeCover} onChange={(e) => setIncludeCover(e.target.checked)} /> Retrieve cover</label>}
      <Button onClick={apply} isLoading={pending} disabled={!selected.length && !selectedCredits.length && !includeCover}>Apply selected metadata</Button>
    </div>}
    {saveIdentifier.error && <p className="text-small text-red" role="alert">{saveIdentifier.error.message}</p>}
    {error && <p className="text-small text-red" role="alert">{error}</p>}
    {done && <output className="text-small text-green">{done}</output>}
  </section>;
}

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { parseIdentifier } from 'shared/identifier';
import { splitNames, type ParsedCredit, type Role } from 'shared/names';
import { supabase } from '@/lib/supabase';
import { metadataLookup, type NormalizedMetadata } from '@/lib/functions';
import { useAuth } from '@/hooks/useAuth';
import { saveCredits, type CreditInput } from '@/hooks/useContributorCredits';
import { parseCsvImport, parseDoiList, type CsvImportRow } from '@/lib/importRows';
import { FIRST_RECORD_TYPE, WORK_TYPES, type WorkType } from '@/lib/recordTypes';

// FR-RES-3: bulk import from a CSV or a DOI list. Rows are validated before anything is written; a
// DOI is created only from real provider data (invariant 5), and a failed lookup is reported per
// row with its typed reason instead of creating a placeholder work.
export interface ImportResult {
  label: string;
  status: 'imported' | 'skipped' | 'failed';
  message?: string;
  workId?: string;
}

function creditInput(parsed: ParsedCredit, role: Role): CreditInput | null {
  if (parsed.rejected || !parsed.parts) return null;
  const org = parsed.parts.kind === 'organization';
  const person = parsed.parts.kind === 'person' ? parsed.parts : null;
  return {
    kind: org ? 'organization' : 'person',
    creditedAs: parsed.raw,
    organizationName: org ? parsed.parts.displayName : '',
    familyName: person?.familyName ?? '',
    givenNames: person?.givenNames ?? '',
    particle: person?.particle ?? '',
    suffix: person?.suffix ?? '',
    role: parsed.roles[0] ?? role,
  };
}

const creditsFromText = (text: string, role: Role = 'author') => splitNames(text).flatMap((p) => creditInput(p, role) ?? []);

interface NewItem {
  userId: string;
  title: string;
  subtitle?: string | null;
  abstract?: string | null;
  language?: string | null;
  workType: WorkType;
  record: { publisher?: string | null; volume?: string | null; issue_number?: string | null; pages?: string | null; publication_date?: string | null; publication_date_precision?: 'year' | 'month' | 'day' | null; metadata_source?: string; metadata_fetched_at?: string };
  identifiers: { scheme: 'doi' | 'isbn'; value: string }[];
  credits: CreditInput[];
  lockCredits: boolean;
}

async function alreadyInLibrary(identifiers: NewItem['identifiers']): Promise<boolean> {
  for (const { scheme, value } of identifiers) {
    const parsed = parseIdentifier(scheme, value);
    if (!parsed.ok) continue;
    const { data, error } = await supabase.from('identifiers').select('record_id').eq('scheme', scheme).eq('normalized_value', parsed.normalized).limit(1);
    if (error) throw error;
    if (data.length) return true;
  }
  return false;
}

async function createItem(item: NewItem): Promise<string> {
  const { data: work, error: workError } = await supabase
    .from('works')
    .insert({ user_id: item.userId, title: item.title, subtitle: item.subtitle ?? null, abstract: item.abstract ?? null, language: item.language ?? null, work_type: item.workType })
    .select('id')
    .single();
  if (workError) throw workError;
  const recordType = FIRST_RECORD_TYPE[item.workType] ?? 'other';
  const { data: record, error: recordError } = await supabase.from('records').insert({ work_id: work.id, record_type: recordType, ...item.record }).select('id').single();
  if (recordError) throw recordError;
  for (const { scheme, value } of item.identifiers) {
    const parsed = parseIdentifier(scheme, value);
    if (!parsed.ok) continue;
    const { error } = await supabase.from('identifiers').insert({ record_id: record.id, scheme, normalized_value: parsed.normalized, original_value: parsed.original });
    if (error) throw error;
  }
  if (item.credits.length) await saveCredits(record.id, item.credits, { lock: item.lockCredits });
  return work.id;
}

async function importCsvRow(userId: string, data: CsvImportRow): Promise<ImportResult> {
  const identifiers = (['doi', 'isbn'] as const).flatMap((scheme) => (data[scheme] ? [{ scheme, value: data[scheme]! }] : []));
  if (await alreadyInLibrary(identifiers)) return { label: data.title, status: 'skipped', message: 'Already in your library (matching identifier).' };
  const workId = await createItem({
    userId,
    title: data.title,
    language: data.language || null,
    workType: data.type,
    record: { publisher: data.publisher || null, publication_date: data.year ? `${data.year}-01-01` : null, publication_date_precision: data.year ? 'year' : null },
    identifiers,
    credits: data.authors ? creditsFromText(data.authors.replaceAll(';', ' & ')) : [],
    lockCredits: true,
  });
  return { label: data.title, status: 'imported', workId };
}

function providerCredits(meta: NormalizedMetadata): CreditInput[] {
  return (meta.contributors ?? []).flatMap((c) => {
    const role: Role = c.role === 'editor' ? 'editor' : 'author';
    if (c.family) {
      return [{ kind: 'person' as const, creditedAs: c.name, organizationName: '', familyName: c.family, givenNames: c.given ?? '', particle: '', suffix: '', role }];
    }
    return creditsFromText(c.name, role);
  });
}

async function importDoi(userId: string, doi: string): Promise<ImportResult> {
  if (await alreadyInLibrary([{ scheme: 'doi', value: doi }])) return { label: doi, status: 'skipped', message: 'Already in your library.' };
  const res = await metadataLookup('doi', doi);
  if (res.status !== 'success') {
    const reasons = { not_found: 'No provider knows this DOI.', invalid_identifier: 'Not a valid DOI.', rate_limited: 'The provider is rate limiting requests; try again shortly.', provider_error: 'The provider returned an error.' } as const;
    return { label: doi, status: 'failed', message: reasons[res.status] };
  }
  const meta = res.data;
  if (!meta.title) return { label: doi, status: 'failed', message: 'The provider returned no title.' };
  const workType = (WORK_TYPES as readonly string[]).includes(meta.work_type) ? (meta.work_type as WorkType) : 'article';
  const workId = await createItem({
    userId,
    title: meta.title,
    subtitle: meta.subtitle,
    abstract: meta.abstract,
    language: meta.language,
    workType,
    record: {
      publisher: meta.publisher, volume: meta.volume, issue_number: meta.issue_number, pages: meta.pages,
      publication_date: meta.publication_date, publication_date_precision: meta.publication_date_precision,
      metadata_source: meta.source_provider, metadata_fetched_at: res.fetchedAt,
    },
    identifiers: [{ scheme: 'doi', value: doi }],
    credits: providerCredits(meta),
    lockCredits: false,
  });
  return { label: meta.title, status: 'imported', workId };
}

export function useImport() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [results, setResults] = useState<ImportResult[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  async function run(mode: 'doi' | 'csv', text: string) {
    const userId = session!.user.id;
    setResults([]);
    setRunning(true);
    const jobs: { label: string; work: () => Promise<ImportResult> }[] = [];
    let errors: { line: number; message: string }[];
    if (mode === 'doi') {
      const parsed = parseDoiList(text);
      errors = parsed.errors;
      parsed.dois.forEach((doi) => jobs.push({ label: doi, work: () => importDoi(userId, doi) }));
    } else {
      const parsed = parseCsvImport(text);
      errors = parsed.errors;
      parsed.rows.forEach((r) => jobs.push({ label: r.data.title, work: () => importCsvRow(userId, r.data) }));
    }
    setParseErrors(errors.map((e) => `Line ${e.line}: ${e.message}`));
    // Sequential on purpose: keeps provider rate limits and contributor matching (which reads earlier rows) predictable.
    for (const job of jobs) {
      const result = await job.work().catch((e: Error): ImportResult => ({ label: job.label, status: 'failed', message: e.message }));
      setResults((prev) => [...prev, result]);
    }
    setRunning(false);
    queryClient.invalidateQueries();
  }

  return { run, results, parseErrors, running };
}

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { parseIdentifier } from 'shared/identifier';
import { fold, splitNames, type ParsedCredit, type Role } from 'shared/names';
import { supabase } from '@/lib/supabase';
import { validIds } from '@/lib/metadataApply';
import { metadataLookup, type NormalizedMetadata } from '@/lib/functions';
import { useAuth } from '@/hooks/useAuth';
import { type CreditInput } from '@/hooks/useContributorCredits';
import { mapCsvRows, parseDoiList, type ColumnMapping, type CsvImportRow, type CsvTable, type RowError } from '@/lib/importRows';
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
  tags?: string[];
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

// Catalog, identifiers, credits and tags commit together; request IDs survive a retry.
async function createItem(item: NewItem, requestId: string): Promise<string> {
  const identifiers = item.identifiers.map(({ scheme, value }) => {
    const parsed = parseIdentifier(scheme, value);
    if (!parsed.ok) throw new Error(`Invalid ${scheme.toUpperCase()}.`);
    return { scheme, value: parsed.normalized };
  });
  const credits = item.credits.map((row) => {
    const display = row.kind === 'organization' ? row.organizationName : [row.givenNames, row.particle, row.familyName, row.suffix].filter(Boolean).join(' ');
    return { ...(row.contributorId ? { contributor_id: row.contributorId } : {}), kind: row.kind, display_name: display,
      family_name: row.kind === 'person' ? row.familyName : null, given_names: row.givenNames || null, particle: row.particle || null, suffix: row.suffix || null,
      sort_name: row.kind === 'organization' ? display : `${row.particle ? row.particle + ' ' : ''}${row.familyName}${row.givenNames ? ', ' + row.givenNames : ''}`,
      match_key: fold(row.kind === 'organization' ? display : row.familyName), identifiers: row.identifiers ?? {}, role: row.role, credited_as: row.creditedAs || null };
  });
  const payload = { expectedOwner: item.userId, work: { title: item.title, subtitle: item.subtitle ?? null, abstract: item.abstract ?? null, language: item.language ?? null, work_type: item.workType },
    record: { ...item.record, record_type: FIRST_RECORD_TYPE[item.workType] ?? 'other' }, identifiers, credits, tags: item.tags ?? [], lockCredits: item.lockCredits };
  const { data, error } = await supabase.rpc('create_catalog', { p_request: requestId, p_payload: payload });
  if (error) throw error;
  return (data as { workId: string }).workId;
}

const splitTags = (raw?: string) => [...new Set((raw ?? '').split(/[;,]/).map((t) => t.trim()).filter(Boolean))];

async function importCsvRow(userId: string, data: CsvImportRow, requestId: string): Promise<ImportResult> {
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
    tags: splitTags(data.tags),
  }, requestId);
  return { label: data.title, status: 'imported', workId };
}

function providerCredits(meta: NormalizedMetadata): CreditInput[] {
  return (meta.contributors ?? []).flatMap((c) => {
    const role: Role = c.role === 'editor' ? 'editor' : 'author';
    if (c.family) {
      return [{ kind: 'person' as const, creditedAs: c.name, organizationName: '', familyName: c.family, givenNames: c.given ?? '', particle: '', suffix: '', role, identifiers: validIds(c.identifiers) }];
    }
    return creditsFromText(c.name, role).map((credit) => ({ ...credit, identifiers: validIds(c.identifiers) }));
  });
}

async function importDoi(userId: string, doi: string, requestId: string, prepared: { item?: NewItem }): Promise<ImportResult> {
  if (prepared.item) return { label: prepared.item.title, status: 'imported', workId: await createItem(prepared.item, requestId) };
  if (await alreadyInLibrary([{ scheme: 'doi', value: doi }])) return { label: doi, status: 'skipped', message: 'Already in your library.' };
  const res = await metadataLookup('doi', doi);
  if (res.status !== 'success') {
    const reasons = { not_found: 'No provider knows this DOI.', invalid_identifier: 'Not a valid DOI.', rate_limited: 'The provider is rate limiting requests; try again shortly.', provider_error: 'The provider returned an error.' } as const;
    return { label: doi, status: 'failed', message: reasons[res.status] };
  }
  const meta = res.data;
  if (!meta.title) return { label: doi, status: 'failed', message: 'The provider returned no title.' };
  const workType = (WORK_TYPES as readonly string[]).includes(meta.work_type) ? (meta.work_type as WorkType) : 'article';
  prepared.item = {
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
  };
  const workId = await createItem(prepared.item, requestId);
  return { label: meta.title, status: 'imported', workId };
}

export interface PlanItem {
  label: string;
  detail: string;
  run: () => Promise<ImportResult>;
}

// What an import would do, shown to the user before anything is written (Figma "import results").
export interface ImportPlan {
  ready: PlanItem[];
  duplicates: { label: string; reason: string }[];
  invalid: RowError[];
}

// Normalized identifiers of the given values that already exist in the library, as "scheme:value".
async function existingIdentifiers(pairs: { scheme: 'doi' | 'isbn'; value: string }[]): Promise<Set<string>> {
  const normalized = pairs.flatMap(({ scheme, value }) => {
    const parsed = parseIdentifier(scheme, value);
    return parsed.ok ? [parsed.normalized] : [];
  });
  if (!normalized.length) return new Set();
  const { data, error } = await supabase.from('identifiers').select('scheme, normalized_value').in('normalized_value', normalized);
  if (error) throw error;
  return new Set(data.map((r) => `${r.scheme}:${r.normalized_value}`));
}

const identifierKey = (scheme: 'doi' | 'isbn', value: string) => {
  const parsed = parseIdentifier(scheme, value);
  return parsed.ok ? `${scheme}:${parsed.normalized}` : null;
};

async function planCsv(userId: string, table: CsvTable, mapping: ColumnMapping): Promise<ImportPlan> {
  const { rows, errors } = mapCsvRows(table.body, mapping);
  const identifiers = rows.flatMap((r) => (['doi', 'isbn'] as const).flatMap((scheme) => (r.data[scheme] ? [{ scheme, value: r.data[scheme]! }] : [])));
  const existing = await existingIdentifiers(identifiers);
  const seen = new Set<string>();
  const plan: ImportPlan = { ready: [], duplicates: [], invalid: errors };
  for (const { line, data } of rows) {
    const keys = (['doi', 'isbn'] as const).flatMap((scheme) => (data[scheme] ? [identifierKey(scheme, data[scheme]!)] : [])).filter((k): k is string => !!k);
    const label = `Row ${line} · ${data.title}`;
    const clash = keys.find((k) => existing.has(k));
    const repeat = keys.find((k) => seen.has(k));
    if (clash) plan.duplicates.push({ label, reason: `Already in your library (${clash.replace(':', ' ').toUpperCase()}).` });
    else if (repeat) plan.duplicates.push({ label, reason: 'Repeated earlier in this file.' });
    else {
      keys.forEach((k) => seen.add(k));
      const requestId = crypto.randomUUID();
      plan.ready.push({ label, detail: [data.authors, data.year].filter(Boolean).join(' · '), run: () => importCsvRow(userId, data, requestId) });
    }
  }
  return plan;
}

async function planDois(userId: string, text: string): Promise<ImportPlan> {
  const { dois, errors } = parseDoiList(text);
  const existing = await existingIdentifiers(dois.map((value) => ({ scheme: 'doi' as const, value })));
  const plan: ImportPlan = { ready: [], duplicates: [], invalid: errors };
  for (const doi of dois) {
    if (existing.has(`doi:${doi}`)) plan.duplicates.push({ label: doi, reason: 'Already in your library.' });
    else {
      const requestId = crypto.randomUUID();
      const prepared: { item?: NewItem } = {};
      plan.ready.push({ label: doi, detail: 'Looked up on import', run: () => importDoi(userId, doi, requestId, prepared) });
    }
  }
  return plan;
}

export function useImport() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze(build: (userId: string) => Promise<ImportPlan>) {
    setAnalyzing(true);
    setError(null);
    setResults([]);
    try {
      setPlan(await build(session!.user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check the import.');
    } finally {
      setAnalyzing(false);
    }
  }

  // Sequential on purpose: keeps provider rate limits and contributor matching (which reads earlier rows) predictable.
  async function execute() {
    if (!plan) return;
    setResults([]);
    setRunning(true);
    for (const item of plan.ready) {
      const result = await item.run().catch((e: Error): ImportResult => ({ label: item.label, status: 'failed', message: e.message }));
      setResults((prev) => [...prev, result]);
    }
    setRunning(false);
    queryClient.invalidateQueries();
  }

  return {
    plan,
    results,
    analyzing,
    running,
    error,
    analyzeCsv: (table: CsvTable, mapping: ColumnMapping) => analyze((userId) => planCsv(userId, table, mapping)),
    analyzeDois: (text: string) => analyze((userId) => planDois(userId, text)),
    execute,
    reset: () => {
      setPlan(null);
      setResults([]);
      setError(null);
    },
  };
}

import { parseIdentifier } from 'shared/identifier';
import { applyMetadata, defaultSelection, loadCandidates, locks, suggestContributor } from '@/lib/metadataApply';
import { metadataLookup, type NormalizedMetadata } from '@/lib/functions';
import { supabase } from '@/lib/supabase';
import { FIRST_RECORD_TYPE, type WorkType } from '@/lib/recordTypes';

type RecordValue = {
  id: string;
  metadata: unknown;
  metadata_fetched_at: string | null;
  title: string | null;
  publisher: string | null;
  publication_date: string | null;
  record_contributors: { contributor_id: string; role: string; position: number; credited_as: string | null }[];
  record_assets: { assets: { metadata: unknown } | null }[];
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function importMetadata(work: { id: string; title: string; metadata: unknown }, record: RecordValue, onMessage: (message: string) => void) {
  try {
      const cleanTitle = (value: string) => value.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      let metadata: NormalizedMetadata | undefined;
      let fetchedAt = '';
      let identifier: { scheme: 'isbn' | 'doi'; value: string } | undefined;
      const stored = object(record.metadata).lookup_suggestions;
      for (const [key, value] of Object.entries(object(stored))) {
        if (key.startsWith('llm:')) continue;
        const suggestion = object(value);
        const candidate = object(suggestion.data) as unknown as NormalizedMetadata;
        if (typeof candidate.title === 'string') {
          metadata = candidate;
          fetchedAt = typeof suggestion.fetched_at === 'string' ? suggestion.fetched_at : new Date().toISOString();
          const match = /^(isbn|doi):(.+)$/.exec(key);
          if (match) identifier = { scheme: match[1] as 'isbn' | 'doi', value: match[2] };
          if (identifier && ['crossref', 'crossref_journal', 'semantic_scholar'].includes(candidate.source_provider) && !Object.hasOwn(candidate, 'container_title')) metadata = undefined;
          break;
        }
      }
      const links = await supabase.from('record_assets').select('assets(metadata,processing_state)').eq('record_id', record.id);
      if (links.error) throw links.error;
      const filenames = (links.data ?? []).flatMap((link) => link.assets ? [object(link.assets.metadata).filename].filter((name): name is string => typeof name === 'string') : []);
      const titleIsFilename = !!work.title && filenames.some((name) => cleanTitle(name) === cleanTitle(work.title));
      const workLocks = locks(work.metadata).filter((field) => field !== 'title' || !titleIsFilename);
      const recordLocks = locks(record.metadata).filter((field) => {
        if (field === 'publisher' && !record.publisher) return false;
        if ((field === 'publication_date' || field === 'publication_date_precision') && !record.publication_date) return false;
        return true;
      });
      if (titleIsFilename && workLocks.length !== locks(work.metadata).length) {
        const { error } = await supabase.from('works').update({ metadata: { ...object(work.metadata), locked_fields: workLocks } } as never).eq('id', work.id);
        if (error) throw error;
      }
      if (recordLocks.length !== locks(record.metadata).length) {
        const { error } = await supabase.from('records').update({ metadata: { ...object(record.metadata), locked_fields: recordLocks } }).eq('id', record.id);
        if (error) throw error;
      }
      if (record.metadata_fetched_at && !titleIsFilename) return;
      onMessage('Looking for an ISBN or DOI in your file…');
      const deadline = Date.now() + 30_000;
      let extractionPending = false;
      const filenameIsbn = /isbn(?:[-_ ]?1[03])?[:\s_-]*(\d{13}|\d{9}[\dX])/i.exec(`${work.title} ${filenames.join(' ')}`)?.[1];
      if (!metadata && filenameIsbn) {
        const parsed = parseIdentifier('isbn', filenameIsbn);
        if (parsed.ok) identifier = { scheme: 'isbn', value: parsed.normalized };
      }
        if (!metadata) {
          while (!identifier && Date.now() < deadline) {
            const { data: currentLinks, error } = await supabase.from('record_assets').select('assets(metadata,processing_state)').eq('record_id', record.id);
            if (error) throw error;
            const assets = (currentLinks ?? []).flatMap((link) => link.assets ? [link.assets] : []);
            extractionPending = assets.some((asset) => ['pending', 'processing'].includes(asset.processing_state));
            const suggestions = assets.flatMap((asset) => {
              const raw = object(asset.metadata).identifier_suggestions;
              return Array.isArray(raw) ? raw : [];
            });
            const valid = suggestions.flatMap((value) => {
              const suggestion = object(value);
              if (suggestion.scheme !== 'isbn' && suggestion.scheme !== 'doi' || typeof suggestion.value !== 'string') return [];
              const parsed = parseIdentifier(suggestion.scheme, suggestion.value);
              return parsed.ok ? [{ scheme: suggestion.scheme, value: parsed.normalized } as const] : [];
            });
            identifier = valid.find((item) => item.scheme === 'isbn') ?? valid[0];
            if (identifier || assets.length && assets.every((asset) => !['pending', 'processing'].includes(asset.processing_state))) break;
            await pause(2500);
          }
        }
        if (!metadata && !identifier) {
          onMessage(extractionPending ? 'Your file is in the library. Identifier extraction is still running; you can edit the details or return to the library.' : 'No ISBN or DOI found. Your file is in the library; you can add details manually.');
          return;
        }

        if (!metadata && identifier) {
          onMessage(`Found ${identifier.scheme.toUpperCase()} ${identifier.value}; looking up details…`);
          const response = await metadataLookup(identifier.scheme, identifier.value);
          if (response.status !== 'success') { onMessage('No matching metadata found. Your file is in the library; you can add details manually.'); return; }
          metadata = response.data;
          fetchedAt = response.fetchedAt;
        }
        if (!metadata) return;
        const data = metadata;
        onMessage(`Applying details from ${data.source_provider}…`);
        const selection = defaultSelection(data, workLocks, recordLocks);
        const candidates = await loadCandidates(data);
        await applyMetadata({
          data,
          fetchedAt,
          selected: selection.fields,
          selectedCredits: selection.credits,
          includeCover: !!data.cover_url,
          overrides: {},
          workId: work.id,
          recordId: record.id,
          workLocks,
          recordLocks,
          candidates,
          suggest: (person) => suggestContributor(person, { people: data.contributors ?? [], candidates, workId: work.id, publicationDate: data.publication_date }),
        });
        const recordType = FIRST_RECORD_TYPE[data.work_type as WorkType];
        if (!record.metadata_fetched_at && selection.fields.includes('work_type') && recordType) {
          const { error } = await supabase.from('records').update({ record_type: recordType }).eq('id', record.id);
          if (error) throw error;
        }
        if (identifier) {
          const { error: identifierError } = await supabase.from('identifiers').upsert({ record_id: record.id, scheme: identifier.scheme, normalized_value: identifier.value, original_value: identifier.value }, { onConflict: 'record_id,scheme,normalized_value', ignoreDuplicates: true });
          if (identifierError) throw identifierError;
        }
      onMessage(`Added metadata from ${data.source_provider}${data.cover_url ? ' and queued a cover image' : ''}.`);
  } catch (error) {
    onMessage(error instanceof Error ? `Automatic lookup stopped: ${error.message}. Your file is still in the library.` : 'Automatic lookup stopped. Your file is still in the library.');
  }
}

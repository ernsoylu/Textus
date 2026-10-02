import type { Database } from '@/types/database';

// Turns one activity_overview row into what the Activity page shows: each processing step, overall progress,
// the group it belongs to and a plain-language explanation of what is happening now.
type GeneratedRow = Database['public']['Functions']['activity_overview']['Returns'][number];
// Generated RPC return types mark every column non-null; these can be null.
export type ActivityRow = Omit<GeneratedRow, 'byline' | 'processing_error' | 'passage_index' | 'embedding_index' | 'index_job' | 'queue_ahead' | 'embed_job'> & {
  byline: string | null; processing_error: string | null; passage_index: GeneratedRow['passage_index'] | null; embedding_index: GeneratedRow['embedding_index'] | null;
  index_job: string | null; queue_ahead: number | null; embed_job: string | null;
};
export type StepState = 'done' | 'active' | 'waiting' | 'failed' | 'skipped';
export type ActivityGroup = 'attention' | 'progress' | 'waiting' | 'done';
export interface ActivityView {
  group: ActivityGroup;
  status: string;
  progress: number;
  explanation: string;
  steps: { label: string; state: StepState }[];
  canRetry: boolean;
  canCancel: boolean;
  canReindex: boolean;
}
interface PassageIndex { status?: string; done?: number; total?: number; passages?: number; reason?: string }
interface EmbeddingIndex { status?: string; embedded?: number; total?: number }

const INDEXED_FORMATS = ['pdf', 'epub'];
const METADATA_STEPS = ['fetch_metadata', 'process_cover', 'extract_metadata_ai'];
const fraction = (done?: number, total?: number) => (total ? Math.min(1, (done ?? 0) / total) : 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function activityView(row: ActivityRow): ActivityView {
  const index = (row.passage_index ?? {}) as PassageIndex;
  const embedding = (row.embedding_index ?? {}) as EmbeddingIndex;
  const indexable = INDEXED_FORMATS.includes(row.file_format);
  const read: StepState = row.processing_state === 'ready' ? 'done' : row.processing_state === 'failed' ? 'failed' : row.processing_state === 'processing' ? 'active' : 'waiting';
  const metadataFailed = row.failed_steps.some((step) => METADATA_STEPS.includes(step));
  const metadata: StepState = row.pending_steps.some((step) => METADATA_STEPS.includes(step)) ? 'active' : 'done';
  const finished = ['complete', 'partial', 'no_text', 'not_indexable'].includes(index.status ?? '');
  const searchable = index.status === 'complete' || index.status === 'partial';
  const indexing: StepState = !indexable || index.status === 'no_text' || index.status === 'not_indexable' ? 'skipped'
    : finished ? 'done' : index.status === 'failed' || index.status === 'cancelled' ? 'failed' : index.status === 'indexing' || row.index_job === 'running' ? 'active' : 'waiting';
  const ai: StepState = indexing === 'skipped' || !searchable && finished ? 'skipped'
    : embedding.status === 'complete' ? 'done' : searchable && (embedding.status === 'indexing' || row.embed_job === 'running') ? 'active' : 'waiting';
  const steps = [
    { label: 'Read file', state: read },
    { label: 'Metadata', state: metadata },
    { label: 'Full-text search', state: indexing },
    { label: 'AI search', state: ai },
  ];
  const weight = (state: StepState, share: number, partial = 0) => (state === 'done' || state === 'skipped' ? share : state === 'active' ? share * partial : 0);
  const progress = Math.round(weight(read, 10) + weight(metadata, 10)
    + weight(indexing, 50, fraction(index.done, index.total)) + weight(ai, 30, fraction(embedding.embedded, embedding.total)));
  const failed = read === 'failed' || indexing === 'failed';
  const allDone = steps.every((step) => step.state === 'done' || step.state === 'skipped');
  const group: ActivityGroup = failed ? 'attention' : allDone ? 'done'
    : steps.some((step) => step.state === 'active') || read !== 'done' ? 'progress' : 'waiting';

  let explanation: string;
  if (read === 'failed') explanation = `The file could not be read${row.processing_error ? `: ${row.processing_error}` : '.'}`;
  else if (index.status === 'failed') explanation = 'Indexing stopped after repeated errors. Retry continues from the last checkpoint.';
  else if (index.status === 'cancelled') explanation = 'Indexing was cancelled. Retry to continue from the last checkpoint.';
  else if (read !== 'done') explanation = 'Reading the file to find its text and identifiers.';
  else if (metadata === 'active') explanation = `Looking up catalog details${row.pending_steps.includes('process_cover') ? ' and the cover' : ''}.`;
  else if (indexing === 'waiting') explanation = row.queue_ahead ? `Waiting for its turn to be indexed — ${plural(row.queue_ahead, 'book')} ahead.` : 'Next in line to be indexed.';
  else if (indexing === 'active') explanation = `Splitting the text into searchable passages: ${index.done ?? 0} of ${index.total || '?'} pages or sections.`;
  else if (ai === 'active') explanation = `Preparing passages for AI and cross-language search: ${embedding.embedded ?? 0} of ${embedding.total ?? index.passages ?? '?'}.`;
  else if (ai === 'waiting') explanation = 'Full text is searchable. Waiting to be prepared for AI search.';
  else if (!indexable) explanation = 'Ready to read. Full-text and AI search cover PDF and EPUB files.';
  else if (index.status === 'no_text') explanation = 'No text layer (likely a scan). It can’t be searched until OCR is added.';
  else if (index.status === 'not_indexable') explanation = `This file can’t be indexed${index.reason ? `: ${index.reason}` : '.'}`;
  else if (index.status === 'partial') explanation = `Partly searchable${index.reason ? `: ${index.reason}` : '.'} AI search covers the indexed part.`;
  else explanation = `Searchable by keyword and by AI in any language — ${plural(index.passages ?? 0, 'passage')}.`;
  if (metadataFailed) explanation += ' Metadata lookup failed; you can gather metadata from the book page.';

  const status = group === 'attention' ? 'Needs attention' : group === 'done' ? 'Done' : group === 'waiting' ? 'Waiting'
    : indexing === 'active' ? 'Indexing' : ai === 'active' ? 'Preparing AI search' : metadata === 'active' ? 'Looking up metadata' : 'Reading';
  return {
    group, status, progress, explanation, steps,
    canRetry: index.status === 'failed' || index.status === 'cancelled',
    canCancel: index.status === 'queued' || index.status === 'indexing',
    canReindex: indexable && finished,
  };
}

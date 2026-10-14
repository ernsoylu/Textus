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
  canMoveToTop: boolean;
}
interface PassageIndex { status?: string; done?: number; total?: number; passages?: number; reason?: string }
interface EmbeddingIndex { status?: string; embedded?: number; total?: number }

const INDEXED_FORMATS = new Set(['pdf', 'epub']);
const METADATA_STEPS = new Set(['fetch_metadata', 'process_cover', 'extract_metadata_ai']);
const fraction = (done?: number, total?: number) => (total ? Math.min(1, (done ?? 0) / total) : 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function readState(state: string): StepState {
  if (state === 'ready') return 'done';
  if (state === 'failed') return 'failed';
  if (state === 'processing') return 'active';
  return 'waiting';
}

function indexState(indexable: boolean, index: PassageIndex, finished: boolean, job: string | null): StepState {
  if (!indexable || index.status === 'no_text' || index.status === 'not_indexable') return 'skipped';
  if (finished) return 'done';
  if (index.status === 'failed' || index.status === 'cancelled') return 'failed';
  if (index.status === 'indexing' || job === 'running') return 'active';
  return 'waiting';
}

function aiState(indexing: StepState, searchable: boolean, finished: boolean, embedding: EmbeddingIndex, job: string | null): StepState {
  if (indexing === 'skipped' || !searchable && finished) return 'skipped';
  if (embedding.status === 'complete') return 'done';
  if (searchable && (embedding.status === 'indexing' || job === 'running')) return 'active';
  return 'waiting';
}

function weight(state: StepState, share: number, partial = 0) {
  if (state === 'done' || state === 'skipped') return share;
  return state === 'active' ? share * partial : 0;
}

function activityGroup(read: StepState, indexing: StepState, steps: ActivityView['steps']): ActivityGroup {
  if (read === 'failed' || indexing === 'failed') return 'attention';
  if (steps.every((step) => step.state === 'done' || step.state === 'skipped')) return 'done';
  if (steps.some((step) => step.state === 'active') || read !== 'done') return 'progress';
  return 'waiting';
}

function activityStatus(group: ActivityGroup, indexing: StepState, ai: StepState, metadata: StepState) {
  if (group === 'attention') return 'Needs attention';
  if (group === 'done') return 'Done';
  if (group === 'waiting') return 'Waiting';
  if (indexing === 'active') return 'Indexing';
  if (ai === 'active') return 'Preparing AI search';
  return metadata === 'active' ? 'Looking up metadata' : 'Reading';
}

function completedExplanation(indexable: boolean, index: PassageIndex) {
  const reason = index.reason ? ': ' + index.reason : '.';
  if (!indexable) return 'Ready to read. Full-text and AI search cover PDF and EPUB files.';
  if (index.status === 'no_text') return 'No text layer (likely a scan). It can’t be searched until OCR is added.';
  if (index.status === 'not_indexable') return `This file can’t be indexed${reason}`;
  if (index.status === 'partial') return `Partly searchable${reason} AI search covers the indexed part.`;
  return `Searchable by keyword and by AI in any language — ${plural(index.passages ?? 0, 'passage')}.`;
}

function indexingExplanation(row: ActivityRow, indexing: StepState, ai: StepState, index: PassageIndex, embedding: EmbeddingIndex, indexable: boolean) {
  if (indexing === 'waiting' && !row.passage_index) return 'Waiting for space in the indexing queue.';
  if (indexing === 'waiting') return row.queue_ahead ? `Waiting for its turn to be indexed — ${plural(row.queue_ahead, 'book')} ahead.` : 'Next in line to be indexed.';
  if (indexing === 'active') return `Splitting the text into searchable passages: ${index.done ?? 0} of ${index.total || '?'} pages or sections.`;
  if (ai === 'active') return `Preparing passages for AI and cross-language search: ${embedding.embedded ?? 0} of ${embedding.total ?? index.passages ?? '?'}.`;
  if (ai === 'waiting') {
    const ahead = row.queue_ahead ? ' — ' + plural(row.queue_ahead, 'book') + ' ahead' : '';
    return `Full text is searchable. Waiting to be prepared for AI search${ahead}.`;
  }
  return completedExplanation(indexable, index);
}

function activityExplanation(row: ActivityRow, read: StepState, metadata: StepState, indexing: StepState, ai: StepState, index: PassageIndex, embedding: EmbeddingIndex, indexable: boolean) {
  if (read === 'failed') {
    const reason = row.processing_error ? ': ' + row.processing_error : '.';
    return `The file could not be read${reason}`;
  }
  if (index.status === 'failed') return 'Indexing stopped after repeated errors. Retry continues from the last checkpoint.';
  if (index.status === 'cancelled') return 'Indexing was cancelled. Retry to continue from the last checkpoint.';
  if (read !== 'done') return 'Reading the file to find its text and identifiers.';
  if (metadata === 'active') return `Looking up catalog details${row.pending_steps.includes('process_cover') ? ' and the cover' : ''}.`;
  return indexingExplanation(row, indexing, ai, index, embedding, indexable);
}

export function activityView(row: ActivityRow): ActivityView {
  const index = (row.passage_index ?? {}) as PassageIndex;
  const embedding = (row.embedding_index ?? {}) as EmbeddingIndex;
  const indexable = INDEXED_FORMATS.has(row.file_format);
  const read = readState(row.processing_state);
  const metadataFailed = row.failed_steps.some((step) => METADATA_STEPS.has(step));
  const metadata: StepState = row.pending_steps.some((step) => METADATA_STEPS.has(step)) ? 'active' : 'done';
  const finished = ['complete', 'partial', 'no_text', 'not_indexable'].includes(index.status ?? '');
  const searchable = index.status === 'complete' || index.status === 'partial';
  const indexing = indexState(indexable, index, finished, row.index_job);
  const ai = aiState(indexing, searchable, finished, embedding, row.embed_job);
  const steps = [
    { label: 'Read file', state: read },
    { label: 'Metadata', state: metadata },
    { label: 'Full-text search', state: indexing },
    { label: 'AI search', state: ai },
  ];
  const progress = Math.round(weight(read, 10) + weight(metadata, 10)
    + weight(indexing, 50, fraction(index.done, index.total)) + weight(ai, 30, fraction(embedding.embedded, embedding.total)));
  const group = activityGroup(read, indexing, steps);
  let explanation = activityExplanation(row, read, metadata, indexing, ai, index, embedding, indexable);
  if (metadataFailed) explanation += ' Metadata lookup failed; you can gather metadata from the book page.';
  const status = activityStatus(group, indexing, ai, metadata);
  return {
    group, status, progress, explanation, steps,
    canRetry: read === 'failed' || index.status === 'failed' || index.status === 'cancelled',
    canCancel: index.status === 'queued' || index.status === 'indexing',
    canReindex: indexable && finished,
    canMoveToTop: (indexing === 'waiting' || ai === 'waiting') && !!row.queue_ahead,
  };
}

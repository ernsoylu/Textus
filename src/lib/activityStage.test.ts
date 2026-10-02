import { describe, expect, it } from 'vitest';
import { activityView, type ActivityRow } from './activityStage';

const row = (over: Partial<ActivityRow>): ActivityRow => ({
  asset_id: 'a', work_id: 'w', record_id: 'r', title: 'Book', byline: null, file_format: 'pdf', file_size: 1, added_at: '2026-10-02T00:00:00Z',
  processing_state: 'ready', processing_error: null, passage_index: null, embedding_index: null, index_job: null, queue_ahead: null, embed_job: null,
  pending_steps: [], failed_steps: [], ...over,
});

describe('activityView', () => {
  it('explains a queued book with its place in line', () => {
    const view = activityView(row({ passage_index: { status: 'queued', done: 0, total: 0 }, index_job: 'queued', queue_ahead: 12 }));
    expect(view.group).toBe('waiting');
    expect(view.explanation).toBe('Waiting for its turn to be indexed — 12 books ahead.');
    expect(view.progress).toBe(20);
  });
  it('shows indexing progress by pages', () => {
    const view = activityView(row({ passage_index: { status: 'indexing', done: 50, total: 100, passages: 80 }, index_job: 'running' }));
    expect(view.group).toBe('progress');
    expect(view.status).toBe('Indexing');
    expect(view.progress).toBe(45);
    expect(view.explanation).toContain('50 of 100 pages or sections');
  });
  it('is done once full text and AI search are ready', () => {
    const view = activityView(row({ passage_index: { status: 'complete', done: 10, total: 10, passages: 12 }, embedding_index: { status: 'complete', embedded: 12, total: 12 } }));
    expect(view).toMatchObject({ group: 'done', progress: 100, canReindex: true, canRetry: false });
    expect(view.explanation).toBe('Searchable by keyword and by AI in any language — 12 passages.');
  });
  it('waits for AI search after indexing completes', () => {
    const view = activityView(row({ passage_index: { status: 'complete', done: 10, total: 10, passages: 12 } }));
    expect(view.group).toBe('waiting');
    expect(view.explanation).toBe('Full text is searchable. Waiting to be prepared for AI search.');
  });
  it('treats scans without text as finished, with the reason', () => {
    const view = activityView(row({ passage_index: { status: 'no_text', done: 700, total: 700, passages: 0 } }));
    expect(view.group).toBe('done');
    expect(view.steps.map((step) => step.state)).toEqual(['done', 'done', 'skipped', 'skipped']);
    expect(view.explanation).toContain('OCR');
  });
  it('asks for attention when indexing failed, and offers retry', () => {
    const view = activityView(row({ passage_index: { status: 'failed', done: 3, total: 9 } }));
    expect(view).toMatchObject({ group: 'attention', canRetry: true, status: 'Needs attention' });
  });
  it('mentions a failed metadata lookup without blocking', () => {
    const view = activityView(row({ file_format: 'djvu', failed_steps: ['fetch_metadata'] }));
    expect(view.group).toBe('done');
    expect(view.explanation).toBe('Ready to read. Full-text and AI search cover PDF and EPUB files. Metadata lookup failed; you can gather metadata from the book page.');
  });
});

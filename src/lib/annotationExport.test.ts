import { describe, expect, it } from 'vitest';
import { annotationsToJson, annotationsToMarkdown } from './annotationExport';
import type { AnnotationItem } from '@/hooks/useAnnotations';

const item = (over: Partial<AnnotationItem>): AnnotationItem => ({
  id: '1', record_id: 'r1', asset_id: 'a1', anchor_type: 'pdf_page', anchor_data: { page: 3 }, highlighted_text: null,
  note: 'Check this', color: 'yellow', created_at: null, records: { title: null, work_id: 'w1', works: { title: 'Dune' } }, annotation_tags: [], ...over,
});

describe('annotation export', () => {
  it('groups markdown by record and quotes highlights', () => {
    const md = annotationsToMarkdown([item({}), item({ id: '2', anchor_type: 'epub_cfi', anchor_data: { cfi: 'x' }, highlighted_text: 'a\nb', note: null })]);
    expect(md).toContain('## Dune');
    expect(md).toContain('Check this *(p. 3)*');
    expect(md).toContain('> a\n> b');
  });
  it('emits JSON without the joined record objects', () => {
    const [row] = JSON.parse(annotationsToJson([item({})]));
    expect(row).toMatchObject({ title: 'Dune', note: 'Check this' });
    expect(row.records).toBeUndefined();
  });
});

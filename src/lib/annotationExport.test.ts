import { describe, expect, it } from 'vitest';
import { annotationsToJson, annotationsToMarkdown } from './annotationExport';
import type { AnnotationItem } from '@/hooks/useAnnotations';

const item = (over: Partial<AnnotationItem>): AnnotationItem => ({
  id: '1', record_id: 'r1', asset_id: 'a1', anchor_type: 'pdf_page', anchor_data: { page: 3 }, highlighted_text: null,
  note: 'Check this', color: 'yellow', created_at: null, updated_at: null, records: { title: null, work_id: 'w1', works: { title: 'Dune' } }, annotation_tags: [], ...over,
});

describe('annotation export', () => {
  it('groups markdown by record and quotes highlights', () => {
    const md = annotationsToMarkdown([item({}), item({ id: '2', anchor_type: 'epub_cfi', anchor_data: { cfi: 'x' }, highlighted_text: 'a\nb', note: null })]);
    expect(md).toContain('## Dune');
    expect(md).toContain('Check this *(p. 3)*');
    expect(md).toContain('> a\n> b');
  });
  it('represents ink by page with a link, and keeps the strokes in JSON', () => {
    const stroke = (id: string, page: number) => item({ id, anchor_type: 'pdf_ink', anchor_data: { v: 1, page, tool: 'pen', width: 0.003, points: [[0.1, 0.2]] }, note: null });
    const md = annotationsToMarkdown([item({}), stroke('i1', 4), stroke('i2', 4)]);
    expect(md).toContain('*Ink drawing on p. 4 (2 strokes)* — [open](');
    expect(md).toContain('/read?annotation=i1)');
    const [row] = JSON.parse(annotationsToJson([stroke('i1', 4)]));
    expect(row.anchor_data.points).toEqual([[0.1, 0.2]]);
  });
  it('emits JSON without the joined record objects', () => {
    const [row] = JSON.parse(annotationsToJson([item({})]));
    expect(row).toMatchObject({ title: 'Dune', note: 'Check this' });
    expect(row.records).toBeUndefined();
  });
});

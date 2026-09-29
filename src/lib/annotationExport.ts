import type { AnnotationItem } from '@/hooks/useAnnotations';

// FR-READ-5: annotation export, generated client-side from rows the user can already read (§8.4).
const title = (a: AnnotationItem) => a.records?.title || a.records?.works?.title || 'Untitled';

function location(a: AnnotationItem): string {
  const d = (a.anchor_data ?? {}) as { page?: number };
  return a.anchor_type === 'pdf_page' && d.page ? `p. ${d.page}` : '';
}

export function annotationsToMarkdown(items: AnnotationItem[]): string {
  const byRecord = new Map<string, AnnotationItem[]>();
  for (const a of items) byRecord.set(a.record_id, [...(byRecord.get(a.record_id) ?? []), a]);
  return [...byRecord.values()]
    .map((list) => {
      const lines = list.map((a) => {
        const loc = location(a);
        const quote = a.highlighted_text ? `> ${a.highlighted_text.replace(/\n+/g, '\n> ')}\n\n` : '';
        const where = loc ? ` *(${loc})*` : '';
    return `${quote}${a.note ?? ''}${where}`.trim();
      });
      return `## ${title(list[0])}\n\n${lines.join('\n\n')}\n`;
    })
    .join('\n');
}

export function annotationsToJson(items: AnnotationItem[]): string {
  return JSON.stringify(
    items.map((a) => ({
      record_id: a.record_id,
      asset_id: a.asset_id,
      title: title(a),
      anchor_type: a.anchor_type,
      anchor_data: a.anchor_data,
      highlighted_text: a.highlighted_text,
      note: a.note,
      color: a.color,
      created_at: a.created_at,
    })),
    null,
    2,
  );
}

export function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

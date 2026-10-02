// Labels and value formatting for book history (public.work_events).
const STEPS: Record<string, string> = {
  fetch_metadata: 'metadata lookup', process_cover: 'cover', extract_text: 'reading the file', extract_metadata_ai: 'AI suggestion',
  index_passages: 'indexing', embed_passages: 'AI search', cleanup: 'cleanup', database: 'direct database change', system: 'system', 'history start': 'history start',
};

export function actorLabel(actor: string, detail: string | null): string {
  if (actor === 'user') return 'You';
  if (actor === 'agent') return detail || 'Agent';
  if (actor === 'ai') return detail ? `AI · ${detail}` : 'AI';
  return detail ? `Textus · ${STEPS[detail] ?? detail.replaceAll('_', ' ')}` : 'Textus';
}

export function fieldLabel(key: string): string {
  const name = key === 'user_rating' ? 'rating' : key.replace(/^metadata\./, '').replaceAll('_', ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Credits and other lists read as names; objects as "key: value" pairs.
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === 'object' && 'name' in item) {
        const { name, role } = item as { name: unknown; role?: unknown };
        return role ? `${String(name)} (${String(role)})` : String(name);
      }
      return formatValue(item);
    }).join(', ') || '—';
  }
  const text = Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key.replaceAll('_', ' ')}: ${typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item)}`).join(', ');
  return text.length > 300 ? `${text.slice(0, 300)}…` : text || '—';
}

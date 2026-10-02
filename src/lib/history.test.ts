import { describe, expect, it } from 'vitest';
import { actorLabel, fieldLabel, formatValue } from './history';

describe('history labels', () => {
  it('names who made a change', () => {
    expect(actorLabel('user', null)).toBe('You');
    expect(actorLabel('agent', 'Hermes')).toBe('Hermes');
    expect(actorLabel('ai', 'qwen3.5:4b')).toBe('AI · qwen3.5:4b');
    expect(actorLabel('textus', 'fetch_metadata')).toBe('Textus · metadata lookup');
    expect(actorLabel('textus', 'database')).toBe('Textus · direct database change');
  });
  it('formats fields and values for reading', () => {
    expect(fieldLabel('user_rating')).toBe('Rating');
    expect(fieldLabel('metadata.container_title')).toBe('Container title');
    expect(formatValue(null)).toBe('—');
    expect(formatValue([{ name: 'Ada Author', role: 'author' }, { name: 'Bea Editor', role: 'editor' }])).toBe('Ada Author (author), Bea Editor (editor)');
    expect(formatValue({ role: 'primary', file_size: 2048 })).toBe('role: primary, file size: 2048');
  });
});

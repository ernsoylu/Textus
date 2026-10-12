import { ANNOTATION_COLORS, highlightFill } from '@/hooks/useAnnotations';
import { ColorSwatch } from './ColorSwatch';

// The reader's actions for selected text: highlight in a color, highlight with a comment, or copy. A right-click
// menu with a mouse; a bar at the bottom of the screen after a touch selection (FR-READ-9). A failed highlight
// keeps the menu and the selection, with the reason (FR-READ-12).
export function SelectionMenu({ quote, notice, busy, error, bar, onHighlight, onComment, onCopy }: Readonly<{ quote: string; notice?: string; busy?: boolean; error?: string | null; bar?: boolean; onHighlight: (color: string) => void; onComment: () => void; onCopy: () => void }>) {
  const item = `flex min-h-11 items-center gap-2 rounded-4 px-2 text-left text-small text-fg hover:bg-bg focus-visible:bg-bg disabled:opacity-60 ${bar ? '' : 'w-full'}`;
  return (
    <div className="flex flex-col gap-1">
      {!bar && <p className="line-clamp-2 px-2 font-serif text-small italic text-muted">“{quote}”</p>}
      {notice && <p className="px-2 text-small text-yellow">{notice}</p>}
      <div className={bar ? 'flex flex-wrap items-center gap-1' : 'flex flex-col gap-1'}>
        <div className="flex items-center px-1" role="group" aria-label="Highlight">
          <span className="px-1 text-small text-fg">{busy ? 'Saving…' : 'Highlight'}</span>
          {ANNOTATION_COLORS.map((c) => (
            <ColorSwatch key={c} role="menuitem" aria-label={`Highlight ${c}`} disabled={busy} fill={highlightFill(c)} onClick={() => onHighlight(c)} />
          ))}
        </div>
        <button type="button" role="menuitem" className={item} disabled={busy} onClick={onComment}>💬 Add comment…</button>
        <button type="button" role="menuitem" className={item} onClick={onCopy}>Copy text</button>
      </div>
      {error && <p role="alert" className="px-2 text-small text-red">Could not save the highlight: {error} Tap a color to retry.</p>}
    </div>
  );
}

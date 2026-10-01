import { ANNOTATION_COLORS, highlightFill } from '@/hooks/useAnnotations';

// The reader's right-click menu for selected text: highlight in a color, highlight with a comment, or copy.
export function SelectionMenu({ quote, onHighlight, onComment, onCopy }: Readonly<{ quote: string; onHighlight: (color: string) => void; onComment: () => void; onCopy: () => void }>) {
  const item = 'flex w-full items-center gap-2 rounded-4 px-2 py-1.5 text-left text-small text-fg hover:bg-bg focus-visible:bg-bg';
  return (
    <div className="flex flex-col gap-1">
      <p className="line-clamp-2 px-2 font-serif text-small italic text-muted">“{quote}”</p>
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="text-small text-fg">Highlight</span>
        {ANNOTATION_COLORS.map((c) => (
          <button key={c} type="button" role="menuitem" aria-label={`Highlight ${c}`} onClick={() => onHighlight(c)} style={{ backgroundColor: highlightFill(c) }} className="h-6 w-6 rounded-full border border-border hover:ring-2 hover:ring-fg" />
        ))}
      </div>
      <button type="button" role="menuitem" className={item} onClick={onComment}>💬 Add comment…</button>
      <button type="button" role="menuitem" className={item} onClick={onCopy}>Copy text</button>
    </div>
  );
}

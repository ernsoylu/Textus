import { ANNOTATION_COLORS, INK_COLORS, highlightFill, inkFill } from '@/hooks/useAnnotations';
import { useOnline } from '@/hooks/useOnline';
import type { ReaderPrefs } from '@/hooks/useReaderPrefs';
import type { InkStatus } from '@/hooks/useInk';
import { Button } from '@/components/ui/button';
import { ColorSwatch } from './ColorSwatch';

// Stroke widths as fractions of the page width (small, medium, large).
export const INK_WIDTHS = { pen: [0.0015, 0.003, 0.006], highlighter: [0.01, 0.018, 0.028] } as const;
const TOOLS = [['pen', 'Pen'], ['highlighter', 'Highlighter'], ['eraser', 'Eraser']] as const;
const SIZES = ['Thin', 'Medium', 'Thick'];
const BTN = 'min-h-11 min-w-11 px-2';

// FR-READ-10/12, Figma R02/R11: the Mark-mode tools. Undo/redo, the eraser and finger drawing are labeled
// buttons (no gesture-only actions); the save state sits next to them with a Retry after a failure.
export function InkToolbar({ prefs, update, status, error, unsaved, canUndo, canRedo, onUndo, onRedo, onRetry, onDone }: Readonly<{
  prefs: ReaderPrefs;
  update: (patch: Partial<ReaderPrefs>) => void;
  status: InkStatus;
  error: string | null;
  unsaved: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRetry: () => void;
  onDone: () => void;
}>) {
  const online = useOnline();
  const tool = prefs.inkTool;
  const colorKey = tool === 'highlighter' ? 'highlighterColor' : 'penColor';
  const message = !online && unsaved ? 'Offline — not saved' : status === 'saving' ? 'Saving…' : status === 'saved' && !unsaved ? 'Saved' : status === 'error' ? `Could not save: ${error ?? ''}` : '';
  return (
    <div role="toolbar" aria-label="Drawing tools" className="flex flex-wrap items-center gap-1 rounded-8 border border-border bg-raised p-1 shadow">
      <div role="radiogroup" aria-label="Tool" className="flex">
        {TOOLS.map(([value, label]) => (
          <Button key={value} role="radio" aria-checked={tool === value} variant={tool === value ? 'secondary' : 'ghost'} className={`${BTN} ${tool === value ? 'ring-2 ring-green' : ''}`} onClick={() => update({ inkTool: value })}>{label}</Button>
        ))}
      </div>
      {tool !== 'eraser' && (
        <>
          <div role="radiogroup" aria-label="Ink color" className="flex">
            {(tool === 'pen' ? INK_COLORS : ANNOTATION_COLORS).map((c) => (
              <ColorSwatch key={c} role="radio" aria-checked={prefs[colorKey] === c} aria-label={c} selected={prefs[colorKey] === c} fill={tool === 'pen' ? inkFill('pen', c) : highlightFill(c)} onClick={() => update({ [colorKey]: c })} />
            ))}
          </div>
          <label className="flex items-center gap-1 text-small text-fg">
            <span className="sr-only">Stroke width</span>
            <select value={prefs.inkSize} onChange={(e) => update({ inkSize: Number(e.target.value) })} className="min-h-11 rounded-4 border border-muted bg-dim px-2 text-small text-fg" aria-label="Stroke width">
              {SIZES.map((s, i) => <option key={s} value={i}>{s}</option>)}
            </select>
          </label>
        </>
      )}
      <Button variant="ghost" className={BTN} aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>↶</Button>
      <Button variant="ghost" className={BTN} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={onRedo}>↷</Button>
      <label className="flex min-h-11 items-center gap-2 px-2 text-small text-fg">
        <input type="checkbox" role="switch" checked={prefs.fingerDraw} onChange={(e) => update({ fingerDraw: e.target.checked })} className="h-5 w-5" />
        Draw with finger
      </label>
      <span className={`px-1 text-small ${status === 'error' || (!online && unsaved) ? 'text-red' : 'text-muted'}`} role="status" aria-live="polite">{message}</span>
      {status === 'error' && <Button variant="secondary" className={BTN} onClick={onRetry}>Retry</Button>}
      <Button variant="primary" className={`${BTN} ml-auto`} onClick={onDone}>Done</Button>
    </div>
  );
}

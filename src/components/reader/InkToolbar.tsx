import { ANNOTATION_COLORS, INK_COLORS, highlightFill, inkFill } from '@/hooks/useAnnotations';
import { useOnline } from '@/hooks/useOnline';
import type { ReaderPrefs } from '@/hooks/useReaderPrefs';
import type { InkStatus } from '@/hooks/useInk';
import { Button } from '@/components/ui/button';
import { ColorSwatch } from './ColorSwatch';

// Stroke widths as fractions of the page width (small, medium, large).
export const INK_WIDTHS = { pen: [0.0015, 0.003, 0.006], highlighter: [0.01, 0.018, 0.028] } as const;
// 24 × 24 stroke icons drawn inline (no icon dependency), like the comment marker in pageGeometry.ts.
const ICONS = {
  pen: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'],
  highlighter: ['m9 11-6 6v3h9l3-3', 'm22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'],
  eraser: ['m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21', 'M22 21H7', 'm5 11 9 9'],
  undo: ['M3 7v6h6', 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'],
  redo: ['M21 7v6h-6', 'M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7'],
  finger: ['M8 13V4.5a1.5 1.5 0 0 1 3 0V12', 'M11 11.5v-2a1.5 1.5 0 0 1 3 0V12', 'M14 10.5a1.5 1.5 0 0 1 3 0V12', 'M17 11.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-2a6 6 0 0 1-4.6-2.2l-2.8-3.3a1.6 1.6 0 0 1 2.5-2L8 15.5'],
} as const;

function Icon({ name }: Readonly<{ name: keyof typeof ICONS }>) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

const TOOLS = [['pen', 'Pen'], ['highlighter', 'Highlighter (keeps the text it covers as a note)'], ['eraser', 'Eraser']] as const;
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
  const message = saveMessage(online, unsaved, status, error);
  return (
    <div role="toolbar" aria-label="Drawing tools" className="flex flex-wrap items-center gap-1 rounded-8 border border-border bg-raised p-1 shadow">
      <div role="radiogroup" aria-label="Tool" className="flex">
        {TOOLS.map(([value, label]) => (
          <Button key={value} role="radio" aria-checked={tool === value} aria-label={label.split(' (')[0]} title={label} variant={tool === value ? 'secondary' : 'ghost'} className={`${BTN} ${tool === value ? 'ring-2 ring-green' : ''}`} onClick={() => update({ inkTool: value })}>
            <Icon name={value} />
          </Button>
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
      <Button variant="ghost" className={BTN} aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}><Icon name="undo" /></Button>
      <Button variant="ghost" className={BTN} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={onRedo}><Icon name="redo" /></Button>
      <Button
        role="switch"
        aria-checked={prefs.fingerDraw}
        aria-label="Draw with finger"
        title={prefs.fingerDraw ? 'Draw with finger: on (one finger draws, two fingers scroll and zoom)' : 'Draw with finger: off (fingers scroll; Apple Pencil and mouse draw)'}
        variant={prefs.fingerDraw ? 'secondary' : 'ghost'}
        className={`${BTN} ${prefs.fingerDraw ? 'ring-2 ring-green' : ''}`}
        onClick={() => update({ fingerDraw: !prefs.fingerDraw })}
      >
        <Icon name="finger" />
      </Button>
      <output className={`px-1 text-small ${status === 'error' || (!online && unsaved) ? 'text-red' : 'text-muted'}`} aria-live="polite">{message}</output>
      {status === 'error' && <Button variant="secondary" className={BTN} onClick={onRetry}>Retry</Button>}
      <Button variant="primary" className={`${BTN} ml-auto`} onClick={onDone}>Done</Button>
    </div>
  );
}

function saveMessage(online: boolean, unsaved: number, status: InkStatus, error: string | null) {
  if (!online && unsaved) return 'Offline — not saved';
  if (status === 'saving') return 'Saving…';
  if (status === 'saved' && !unsaved) return 'Saved';
  return status === 'error' ? `Could not save: ${error ?? ''}` : '';
}

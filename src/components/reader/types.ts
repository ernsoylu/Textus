import type { Anchor, InkData } from '@/hooks/useAnnotations';
import type { Progress } from '@/hooks/useReadingState';

// The contract between the Reader page and each format viewer. Viewers only know geometry: they draw
// highlights and comment markers, report selections and clicks with screen coordinates, and the Reader
// page owns every menu, popover and write — so they work the same for all formats and inside fullscreen.
export interface ViewerAnnotation {
  id: string;
  anchor: Anchor;
  color: string;
  note: string | null;
}

export interface ViewerSelection {
  text: string;
  anchor: Anchor;
  /** Set when the selection had to be cut down (e.g. to its first page); shown before saving. */
  notice?: string;
}

// FR-READ-10: a saved (or still saving) ink stroke, and the active Mark-mode tool.
export interface InkStroke {
  id: string;
  data: InkData;
  color: string | null;
  /** The text a highlighter stroke covers (saved as highlighted_text). */
  text?: string | null;
  unsaved?: boolean;
}

export interface InkSettings {
  tool: 'pen' | 'highlighter' | 'eraser';
  color: string;
  /** Fraction of the page width. */
  width: number;
  fingerDraw: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[];
}

export interface ViewerProps {
  storagePath: string;
  annotations: ViewerAnnotation[];
  /** Go to this anchor; a new object (not a new value) triggers the jump again. */
  goTo?: { anchor: Anchor };
  onSelect?: (selection: ViewerSelection | null) => void;
  /** Right-click while text is selected: the Reader opens its selection menu at this point. */
  onContextMenu?: (at: Point) => void;
  /** A highlight or its comment marker was clicked. */
  onOpenAnnotation?: (id: string, at: Point) => void;
  onProgress?: (progress: Progress) => void;
  /** Focus mode (FR-READ-7): hide the viewer's own toolbars; keyboard navigation keeps working. */
  focus?: boolean;
}

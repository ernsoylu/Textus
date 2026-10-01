// Just enough typing for the parts of foliate-js (https://github.com/johnfactotum/foliate-js, pinned in
// package.json) that BookViewer uses. The library ships untyped ES modules.
declare module 'foliate-js/view.js' {
  export interface FoliateTocItem {
    label: string;
    href: string;
    subitems?: FoliateTocItem[] | null;
  }

  export interface FoliateLocation {
    fraction: number;
    cfi: string;
    tocItem?: { label: string; href: string } | null;
    pageItem?: { label: string } | null;
    location?: { current: number; next: number; total: number };
    section?: { current: number; total: number };
  }

  export interface FoliateSearchExcerpt {
    pre: string;
    match: string;
    post: string;
  }

  export type FoliateSearchResult =
    | 'done'
    | { progress: number }
    | { label: string; subitems: { cfi: string; excerpt: FoliateSearchExcerpt }[] };

  export interface FoliateAnnotation {
    value: string;
    [key: string]: unknown;
  }

  export interface FoliateRenderer extends HTMLElement {
    setStyles?: (css: string) => void;
    next(): Promise<void>;
    prev(): Promise<void>;
  }

  export interface FoliateView extends HTMLElement {
    book: { toc?: FoliateTocItem[]; dir?: string; transformTarget?: EventTarget };
    renderer: FoliateRenderer;
    isFixedLayout: boolean;
    lastLocation: FoliateLocation | null;
    open(file: Blob): Promise<void>;
    init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
    close(): void;
    goTo(target: string | number): Promise<unknown>;
    goToFraction(fraction: number): Promise<void>;
    goLeft(): Promise<void>;
    goRight(): Promise<void>;
    prev(): Promise<void>;
    next(): Promise<void>;
    getCFI(index: number, range?: Range): string;
    getSectionFractions(): number[];
    addAnnotation(annotation: FoliateAnnotation, remove?: boolean): Promise<unknown>;
    deleteAnnotation(annotation: FoliateAnnotation): Promise<unknown>;
    search(options: { query: string; matchCase?: boolean; matchWholeWords?: boolean }): AsyncGenerator<FoliateSearchResult>;
    clearSearch(): void;
    deselect(): void;
  }
}

declare module 'foliate-js/overlayer.js' {
  export const Overlayer: {
    highlight(rects: DOMRectList, options?: { color?: string }): SVGElement;
  };
}

// Document formats with an in-browser reader (FR-READ-1/2/6): pdf.js for PDF, foliate-js for the e-book
// formats, DjVu.js for DjVu. Keep in sync with library_page()'s reader target (migration 20260930000006).
export const VIEWABLE_FORMATS = ['pdf', 'epub', 'mobi', 'azw3', 'cbz', 'djvu'] as const;
export const BOOK_FORMATS = ['epub', 'mobi', 'azw3', 'cbz'] as const;

export const isViewable = (format: string | null | undefined) => (VIEWABLE_FORMATS as readonly string[]).includes(format ?? '');
export const isBookFormat = (format: string | null | undefined) => (BOOK_FORMATS as readonly string[]).includes(format ?? '');

# DjVu.js (vendored)

Built from https://github.com/RussCoder/djvujs at commit `eca3e69` (`cd library && npm install && npm run build`, output `library/dist/djvu.js`), unmodified.
It isn't published on npm. The library is GPL-2.0-or-later (`LICENSE`), which is compatible with Textus' AGPL-3.0.
Loaded on demand by `src/components/reader/DjvuViewer.tsx`; it decodes pages in a Web Worker it starts from a `blob:` URL.

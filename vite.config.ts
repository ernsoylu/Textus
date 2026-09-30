import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// foliate-js can open PDFs through its own vendored pdf.js. Textus reads PDFs with pdfjs-dist directly, so that
// adapter (~3 MB of duplicate pdf.js, using top-level await) is swapped for a stub that is never called.
const FOLIATE_PDF_STUB = '\0foliate-pdf-stub';
const skipFoliatePdf: Plugin = {
  name: 'textus:skip-foliate-pdf',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === './pdf.js' && importer?.replaceAll('\\', '/').includes('/foliate-js/view.js')) return FOLIATE_PDF_STUB;
    return null;
  },
  load(id) {
    return id === FOLIATE_PDF_STUB ? "export const makePDF = () => { throw new Error('PDFs open in the PDF viewer.'); };" : null;
  },
};

export default defineConfig({
  plugins: [skipFoliatePdf, react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      shared: path.resolve(__dirname, './shared'),
    },
  },
  // foliate-js ships native ES modules that load their parts lazily; serve them as they are.
  optimizeDeps: { exclude: ['foliate-js'] },
  server: { port: 5173 },
});

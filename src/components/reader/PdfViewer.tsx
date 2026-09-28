import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

// FR-READ-1. Files are private (invariant 7): always a short-lived signed URL, never
// getPublicUrl(). §9.3 step 1 — this loads whichever asset the caller resolved.
export interface PdfViewerProps {
  bucket: 'documents';
  storagePath: string;
  initialPage?: number;
  onFirstPageRendered?: (canvas: HTMLCanvasElement) => void;
}

export function PdfViewer({ bucket, storagePath, initialPage = 1, onFirstPageRendered }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const capturedFirstPage = useRef(false);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error: signError } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 300);
      if (signError || !data) throw signError ?? new Error('Could not create a signed URL.');
      const task = pdfjsLib.getDocument({ url: data.signedUrl });
      taskRef.current = task;
      const doc = await task.promise;
      if (cancelled) return;
      docRef.current = doc;
      setPageCount(doc.numPages);
      setLoading(false);
    })().catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      taskRef.current?.destroy();
    };
  }, [bucket, storagePath]);

  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || loading) return;
    let cancelled = false;
    (async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: zoom });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await pdfPage.render({ canvasContext: ctx, viewport, canvas }).promise;
      if (cancelled) return;
      // §15 Q2's proposed thumbnail path: capture page 1 on first render, client-side, rather
      // than a server-side rasterizer (Deno edge functions can't render PDF pages — see
      // supabase/functions/job-worker's generate_thumbnail handling).
      if (page === 1 && !capturedFirstPage.current) {
        capturedFirstPage.current = true;
        onFirstPageRendered?.(canvas);
      }
    })().catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [page, zoom, loading, onFirstPageRendered]);

  if (error) return <p className="text-body text-red">Could not load this file: {error}</p>;
  if (loading) return <p className="text-body text-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <p className="text-small text-fg">
          Page {page} of {pageCount}
        </p>
        <Button variant="secondary" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
        <Button variant="ghost" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
          Zoom out
        </Button>
        <p className="text-small text-muted">{Math.round(zoom * 100)}%</p>
        <Button variant="ghost" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
          Zoom in
        </Button>
      </div>
      <canvas ref={canvasRef} className="max-w-full rounded-8 border border-border" />
    </div>
  );
}

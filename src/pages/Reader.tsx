import { useCallback, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAsset } from '@/hooks/useAsset';
import { useUploadAsset } from '@/hooks/useUploadAsset';
import { useReadingState, useProgressSaver, useSaveReadingState, READING_STATUSES, type ReadingStatus } from '@/hooks/useReadingState';
import { anchorSchema, useAnnotations, useCreateAnnotation, type Anchor, type AnnotationItem } from '@/hooks/useAnnotations';
import { supabase } from '@/lib/supabase';
import { PdfViewer, type PdfHighlight, type PdfSelection } from '@/components/reader/PdfViewer';
import { EpubViewer } from '@/components/reader/EpubViewer';
import { AnnotationForm } from '@/components/reader/AnnotationForm';
import { AnnotationPanel } from '@/components/reader/AnnotationPanel';
import { DownloadButton } from '@/components/library/DownloadButton';

// FR-READ-1/2 viewers, FR-READ-3 progress + status, FR-READ-4/5 annotations.
// FR-READ-6: formats without a reader (MOBI/AZW3/CBZ) get a download instead.
export function Reader() {
  const { workId, recordId, assetId } = useParams<{ workId: string; recordId: string; assetId: string }>();
  const { data: asset, isLoading, error } = useAsset(assetId);
  const state = useReadingState(recordId);
  const annotations = useAnnotations(assetId);
  const createAnnotation = useCreateAnnotation();
  const saveState = useSaveReadingState(recordId!);
  const uploadAsset = useUploadAsset(recordId!);
  const saveProgress = useProgressSaver(recordId!, assetId!, state.data?.status as ReadingStatus | undefined);
  const capturedRef = useRef(false);
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<{ text: string; anchor: Anchor } | null>(null);
  const [goToPage, setGoToPage] = useState<number>();
  const [goToCfi, setGoToCfi] = useState<string>();

  const handleFirstPageRendered = useCallback(
    async (canvas: HTMLCanvasElement) => {
      if (capturedRef.current || !recordId) return;
      capturedRef.current = true;
      // §15 Q2's client-side thumbnail path: only capture once per record (skip if a cover exists).
      const { data: existingCover } = await supabase.from('record_assets').select('asset_id').eq('record_id', recordId).eq('role', 'cover').maybeSingle();
      if (existingCover) return;
      canvas.toBlob((blob) => {
        if (!blob) return;
        uploadAsset.mutate({ role: 'cover', file: new File([blob], 'cover.png', { type: 'image/png' }) });
      }, 'image/png');
    },
    [recordId, uploadAsset],
  );

  const handlePageChange = useCallback(
    (p: number, count: number) => {
      setPage(p);
      saveProgress({ percentage: (p / count) * 100, page: p, position: { page: p } });
    },
    [saveProgress],
  );

  const highlights = useMemo(
    () =>
      (annotations.data ?? []).flatMap((a) => {
        const anchor = anchorSchema.safeParse({ anchor_type: a.anchor_type, anchor_data: a.anchor_data });
        return anchor.success && anchor.data.anchor_type === 'epub_cfi' ? [{ id: a.id, cfi: anchor.data.anchor_data.cfi, color: a.color ?? 'yellow' }] : [];
      }),
    [annotations.data],
  );

  const pdfHighlights = useMemo<PdfHighlight[]>(
    () =>
      (annotations.data ?? []).flatMap((a) => {
        const anchor = anchorSchema.safeParse({ anchor_type: a.anchor_type, anchor_data: a.anchor_data });
        if (!anchor.success || anchor.data.anchor_type !== 'pdf_page' || !anchor.data.anchor_data.rects?.length) return [];
        return [{ id: a.id, page: anchor.data.anchor_data.page, rects: anchor.data.anchor_data.rects, color: a.color ?? 'yellow' }];
      }),
    [annotations.data],
  );

  const handlePdfSelect = useCallback((s: PdfSelection) => setSelection({ text: s.text, anchor: { anchor_type: 'pdf_page', anchor_data: { page: s.page, rects: s.rects } } }), []);
  const handleEpubSelect = useCallback((s: { cfi: string; text: string } | null) => setSelection(s ? { text: s.text, anchor: { anchor_type: 'epub_cfi', anchor_data: { cfi: s.cfi } } } : null), []);

  function handleGoTo(a: AnnotationItem) {
    const anchor = anchorSchema.safeParse({ anchor_type: a.anchor_type, anchor_data: a.anchor_data });
    if (!anchor.success) return;
    if (anchor.data.anchor_type === 'pdf_page') setGoToPage(anchor.data.anchor_data.page);
    else setGoToCfi(anchor.data.anchor_data.cfi);
  }

  if (isLoading || state.isLoading) return <p className="text-body text-muted">Loading…</p>;
  if (error) return <p className="text-body text-red">Could not load this file: {error.message}</p>;
  if (!asset || !recordId || !assetId) return null;

  const saved = state.data;
  // Resume only when the saved position belongs to this asset (a record can have PDF and EPUB).
  const resume = saved?.asset_id === assetId ? saved : null;
  const isPdf = asset.file_format === 'pdf';
  const isEpub = asset.file_format === 'epub';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={`/library/${workId}`} className="text-small text-muted underline">Back to book</Link>
        <label className="flex items-center gap-2 text-small text-fg">
          Status{' '}
          <select
            aria-label="Reading status"
            className="rounded-8 border border-muted bg-dim p-2 text-body text-fg"
            value={saved?.status ?? 'unread'}
            onChange={(e) => saveState.mutate({ status: e.target.value as ReadingStatus })}
          >
            {READING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {resume && <span className="text-muted">{Math.round(Number(resume.progress_percentage))}%</span>}
        </label>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-0 flex-1 basis-[480px]">
          {isPdf && (
            <PdfViewer
              bucket="documents"
              storagePath={asset.storage_path}
              initialPage={resume?.current_page ?? 1}
              goToPage={goToPage}
              highlights={pdfHighlights}
              onSelect={handlePdfSelect}
              onPageChange={handlePageChange}
              onFirstPageRendered={handleFirstPageRendered}
            />
          )}
          {isEpub && (
            <EpubViewer
              storagePath={asset.storage_path}
              initialCfi={(resume?.current_position as { cfi?: string } | null)?.cfi}
              goTo={goToCfi}
              highlights={highlights}
              onProgress={saveProgress}
              onSelect={handleEpubSelect}
            />
          )}
          {!isPdf && !isEpub && (
            <div className="flex items-center gap-3">
              <p className="text-body text-muted">In-browser reading isn't available for {asset.file_format} files.</p>
              <DownloadButton bucket={asset.bucket} storagePath={asset.storage_path} />
            </div>
          )}
        </div>

        {(isPdf || isEpub) && (
          <div className="flex w-full flex-col lg:w-[300px] gap-4">
            {isPdf && (
              <AnnotationForm
                label={`Add note to page ${page}`}
                isLoading={createAnnotation.isPending}
                onSubmit={(color, note) => createAnnotation.mutate({ recordId, assetId, anchor: { anchor_type: 'pdf_page', anchor_data: { page } }, color, note })}
              />
            )}
            {selection && (
              <AnnotationForm
                label="Highlight selection"
                quote={selection.text}
                isLoading={createAnnotation.isPending}
                onCancel={() => setSelection(null)}
                onSubmit={(color, note) => createAnnotation.mutate({ recordId, assetId, anchor: selection.anchor, text: selection.text, color, note }, { onSuccess: () => setSelection(null) })}
              />
            )}
            {createAnnotation.error && <p className="text-small text-red">{createAnnotation.error.message}</p>}
            <AnnotationPanel items={annotations.data ?? []} onGoTo={handleGoTo} />
          </div>
        )}
      </div>
    </div>
  );
}

import { useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAsset } from '@/hooks/useAsset';
import { useUploadAsset } from '@/hooks/useUploadAsset';
import { supabase } from '@/lib/supabase';
import { PdfViewer } from '@/components/reader/PdfViewer';

// FR-READ-1. Only PDF is wired up — EPUB (FR-READ-2) is M4; MOBI/AZW3/CBZ are
// download-only by design (FR-READ-6), and there's no download button yet either.
export function Reader() {
  const { workId, recordId, assetId } = useParams<{ workId: string; recordId: string; assetId: string }>();
  const { data: asset, isLoading, error } = useAsset(assetId);
  const uploadAsset = useUploadAsset(recordId!);
  const capturedRef = useRef(false);

  const handleFirstPageRendered = useCallback(
    async (canvas: HTMLCanvasElement) => {
      if (capturedRef.current || !recordId) return;
      capturedRef.current = true;
      // §15 Q2's client-side thumbnail path: only capture once per record (skip if a cover
      // already exists), matching what the never-built server-side generate_thumbnail job
      // would otherwise be responsible for deduplicating.
      const { data: existingCover } = await supabase.from('record_assets').select('asset_id').eq('record_id', recordId).eq('role', 'cover').maybeSingle();
      if (existingCover) return;
      canvas.toBlob((blob) => {
        if (!blob) return;
        uploadAsset.mutate({ role: 'cover', file: new File([blob], 'cover.png', { type: 'image/png' }) });
      }, 'image/png');
    },
    [recordId, uploadAsset],
  );

  if (isLoading) return <p className="text-body text-muted">Loading…</p>;
  if (error) return <p className="text-body text-red">Could not load this file: {error.message}</p>;
  if (!asset) return null;

  return (
    <div className="flex flex-col gap-4">
      <Link to={`/library/${workId}`} className="text-small text-muted underline">
        Back to work
      </Link>
      {asset.file_format === 'pdf' ? (
        <PdfViewer bucket="documents" storagePath={asset.storage_path} onFirstPageRendered={handleFirstPageRendered} />
      ) : (
        <p className="text-body text-muted">In-browser reading isn't available for {asset.file_format} files yet.</p>
      )}
    </div>
  );
}

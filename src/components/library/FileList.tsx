import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useRemoveAssetLink } from '@/hooks/useCatalogMutations';
import { StatusBadge } from '@/components/library/StatusBadge';
import { DownloadButton } from '@/components/library/DownloadButton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import type { AssetRow } from '@/types';

interface FileEntry {
  role: string;
  assets: AssetRow | null;
}

function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// FR-FILE-4/6 + FR-READ-6: a record's files with processing state, a way to open or download each,
// and removal (which only detaches the file; see useRemoveAssetLink).
export function FileList({ workId, recordId, files }: Readonly<{ workId: string; recordId: string; files: FileEntry[] }>) {
  const remove = useRemoveAssetLink(workId);
  const [target, setTarget] = useState<{ asset: AssetRow; role: string } | null>(null);
  if (!files.some((f) => f.assets)) return null;

  return (
    <div className="flex flex-col gap-1 pt-2">
      {files.map(({ role, assets: asset }) =>
        asset ? (
          <div key={`${asset.id}:${role}`} className="flex flex-wrap items-center gap-2">
            <StatusBadge state={asset.processing_state} />
            <p className="text-small text-fg">{role} · {asset.file_format} · {formatSize(asset.file_size)}</p>
            {(asset.file_format === 'pdf' || asset.file_format === 'epub') ? (
              <Link to={`/library/${workId}/records/${recordId}/assets/${asset.id}/read`} className="text-small text-green underline">Read</Link>
            ) : (
              <DownloadButton bucket={asset.bucket} storagePath={asset.storage_path} />
            )}
            <Button variant="ghost" onClick={() => setTarget({ asset, role })}>Remove</Button>
          </div>
        ) : null,
      )}
      <ConfirmDialog
        open={!!target}
        title="Remove this file?"
        description="The file is detached from this record. If no other record uses it, it is deleted from storage within a day. Notes and reading progress on it are removed with it."
        confirmLabel="Remove file"
        busy={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => target && remove.mutate({ recordId, assetId: target.asset.id, role: target.role }, { onSettled: () => setTarget(null) })}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}

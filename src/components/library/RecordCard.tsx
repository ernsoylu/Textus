import { Link } from 'react-router-dom';
import { MetadataProgress } from '@/components/metadata/MetadataProgress';

// Figma: "Record card" (node 8:68). `meta` is left to the caller — the Figma mock shows
// "EPUB · 42% read", but that needs asset format + reading_states joined, which the
// Library page doesn't do yet (see src/pages/Library.tsx), so callers pass what they have.
// FR-ORG-4: when `onToggleSelect` is given the card is in bulk-select mode.
export interface RecordCardProps {
  workId: string;
  title: string;
  byline: string;
  meta: string;
  detail?: string;
  metadataMessage?: string;
  coverUrl?: string;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export function RecordCard({ workId, title, byline, meta, detail, metadataMessage, coverUrl, selected, onToggleSelect }: Readonly<RecordCardProps>) {
  const body = (
    <>
      {coverUrl ? (
        <img src={coverUrl} alt="" loading="lazy" className="h-[var(--cover-h)] w-full rounded-4 bg-green-bg object-contain" />
      ) : (
        <div className="flex h-[var(--cover-h)] w-full shrink-0 flex-col justify-between gap-2 overflow-hidden rounded-4 bg-green-bg p-4">
          <p className="text-small w-full shrink-0 text-muted">TEXTUS / LIBRARY</p>
          <p className="text-heading min-h-0 w-full line-clamp-[var(--cover-title-lines)] break-words text-fg">{title}</p>
          <p className="text-small w-full shrink-0 line-clamp-2 break-words text-fg">{byline || 'Unattributed'}</p>
        </div>
      )}
      <p className="text-label w-full text-fg">{title}</p>
      <p className="text-small w-full text-muted">{byline || 'Unattributed'}</p>
      <p className="text-small w-full text-green">{meta}</p>
      {detail && <p className="text-small w-full text-muted">{detail}</p>}
      <MetadataProgress message={metadataMessage} />
    </>
  );
  if (!onToggleSelect) {
    return (
      <Link to={`/library/${workId}`} className="flex w-[236px] flex-col gap-3 rounded-8">
        {body}
      </Link>
    );
  }
  return (
    <label className={`flex w-[236px] cursor-pointer flex-col gap-3 rounded-8 ${selected ? 'ring-2 ring-green' : ''}`}>
      <input type="checkbox" checked={!!selected} onChange={onToggleSelect} aria-label={`Select ${title}`} className="self-start" />
      {body}
    </label>
  );
}

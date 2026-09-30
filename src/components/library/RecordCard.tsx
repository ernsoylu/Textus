import { Link } from 'react-router-dom';
import { useUpdateWork } from '@/hooks/useCatalogMutations';
import { Button } from '@/components/ui/button';
import { StarRating } from './StarRating';
import { MetadataProgress } from '@/components/metadata/MetadataProgress';

// Cover controls use sibling links and inputs, never interactive elements inside a link.
// FR-ORG-4: when `onToggleSelect` is given the card is in bulk-select mode.
export interface RecordCardProps {
  workId: string;
  workType?: string;
  readerPath?: string | null;
  title: string;
  byline: string;
  meta: string;
  detail?: string;
  metadataMessage?: string;
  coverUrl?: string;
  userRating?: number | null;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export function RecordCard({ workId, workType = 'book', readerPath, title, byline, meta, detail, metadataMessage, coverUrl, userRating, selected, onToggleSelect }: Readonly<RecordCardProps>) {
  const rate = useUpdateWork(workId);
  const cover = (
    <>
      {coverUrl ? (
        <img src={coverUrl} alt="" loading="lazy" className="h-[var(--cover-h)] w-full rounded-4 bg-green-bg object-contain" />
      ) : (
        <div className="flex h-[var(--cover-h)] w-full shrink-0 flex-col justify-between gap-2 overflow-hidden rounded-4 bg-green-bg p-4">
          <p className="text-small w-full shrink-0 text-fg">TEXTUS / LIBRARY</p>
          <p className="text-heading min-h-0 w-full line-clamp-[var(--cover-title-lines)] break-words text-fg">{title}</p>
          <p className="text-small w-full shrink-0 line-clamp-2 break-words text-fg">{byline || 'Unattributed'}</p>
        </div>
      )}
    </>
  );
  const body = (
    <>
      {onToggleSelect ? cover : <div className="group relative isolate rounded-4">
        <Link to={`/library/${workId}`} aria-label={`Open ${title}`} className="block transition-[filter] group-hover:blur-sm group-focus-within:blur-sm">{cover}</Link>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-4 bg-dim/90 p-2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
          {readerPath ? <Link to={readerPath} className="flex min-h-11 w-full items-center justify-center rounded-8 bg-green px-3 py-2 text-label text-dim">Read</Link> : <Button disabled title="Attach a readable file (PDF, EPUB, MOBI, AZW3, CBZ, DjVu) to read here" className="w-full">Read</Button>}
          <Link to={`/library/${workId}`} className="flex min-h-11 w-full items-center justify-center rounded-8 bg-bg px-3 py-2 text-label text-fg">View details</Link>
          {workType === 'book' && <StarRating value={userRating ?? null} onChange={(value) => rate.mutate({ user_rating: value })} label={`Rate ${title}`} disabled={rate.isPending} />}
        </div>
      </div>}
      {onToggleSelect ? <p title={title} className="text-label w-full line-clamp-2 break-words text-fg">{title}</p> : <Link to={`/library/${workId}`} title={title} className="text-label w-full line-clamp-2 break-words text-fg hover:underline">{title}</Link>}
      {userRating != null && <p className="text-small text-yellow" aria-label={`Your rating: ${userRating} out of 5 stars`}>{userRating} / 5 ★</p>}
      <p title={byline} className="text-small w-full line-clamp-2 break-words text-muted">{byline || 'Unattributed'}</p>
      <p className="text-small w-full text-green">{meta}</p>
      {detail && <p className="text-small w-full text-muted">{detail}</p>}
      <MetadataProgress message={metadataMessage} />
    </>
  );
  if (!onToggleSelect) {
    return (
      <article className="flex w-[236px] max-w-full min-w-0 flex-col gap-3 rounded-8">
        {body}
        {rate.error && <p role="alert" className="text-small text-red">{rate.error.message}</p>}
      </article>
    );
  }
  return (
    <label className={`flex w-[236px] max-w-full min-w-0 cursor-pointer flex-col gap-3 rounded-8 ${selected ? 'ring-2 ring-green' : ''}`}>
      <input type="checkbox" checked={!!selected} onChange={onToggleSelect} aria-label={`Select ${title}`} className="self-start" />
      {body}
    </label>
  );
}

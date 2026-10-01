import { Link } from 'react-router-dom';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import type { WorkListItem } from '@/hooks/useLibrary';

export function BookSearchResults({ items, loading, error, onSelect }: Readonly<{ items: WorkListItem[]; loading: boolean; error?: string; onSelect: () => void }>) {
  const covers = useCoverUrls(items.flatMap((item) => item.coverPath ? [item.coverPath] : []));
  return <ul aria-label="Book search results" className="absolute inset-x-0 top-full z-20 mt-2 max-h-[60vh] overflow-y-auto rounded-8 border border-border bg-bg p-2 shadow-xl" onKeyDown={(event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const links = Array.from(event.currentTarget.querySelectorAll('a'));
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    event.preventDefault();
    links[(index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length]?.focus();
  }}>
    {items.map((item) => <li key={item.workId}>
      <Link to={`/library/${item.workId}`} onClick={onSelect} className="flex items-center gap-3 rounded-8 p-3 text-fg hover:bg-dim focus-visible:bg-dim">
        {item.coverPath && covers.data?.get(item.coverPath) ? <img src={covers.data.get(item.coverPath)} alt="" className="h-20 w-14 shrink-0 rounded-4 object-contain" /> : <div aria-hidden="true" className="flex h-20 w-14 shrink-0 items-center justify-center rounded-4 bg-green-bg font-serif text-heading text-fg">{item.title.slice(0, 1)}</div>}
        <div className="flex min-w-0 flex-col gap-1"><p className="line-clamp-2 break-words text-label">{item.title}</p><p className="line-clamp-1 text-small text-muted">{item.byline || 'Unattributed'}</p><p className="text-small text-muted">{[item.meta, item.detail].filter(Boolean).join(' · ')}</p></div>
      </Link>
    </li>)}
    {loading && <li role="status" className="p-3 text-small text-muted">Searching…</li>}
    {error && <li role="alert" className="p-3 text-small text-red">{error}</li>}
    {!loading && !error && !items.length && <li className="p-3 text-small text-muted">No matching books.</li>}
  </ul>;
}

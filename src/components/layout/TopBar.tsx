import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSearch } from '@/hooks/useSearch';
import { Button } from '@/components/ui/button';

// Figma top bar: global search (⌘K / Ctrl+K) and "+ Add to library". Results come from the same
// search_library() RPC as the Library page (FR-SRCH-1); Enter opens them all in the Library.
export function TopBar() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const search = useSearch(query);
  const results = (search.data ?? []).slice(0, 8);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setOpen(false);
    navigate(`/library?q=${encodeURIComponent(query.trim())}`);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-bg p-3">
      <form onSubmit={submit} className="relative flex-1" role="search" onKeyDown={onKeyDown}>
        <input
          ref={inputRef}
          type="search"
          aria-label="Search titles, people, identifiers"
          placeholder="Search titles, people, identifiers…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="w-full rounded-8 bg-dim p-3 text-body text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 text-small text-muted md:block">⌘K</kbd>
        {open && query.trim() && (
          <ul className="absolute inset-x-0 top-full mt-1 flex flex-col rounded-8 border border-border bg-raised p-1 shadow-lg">
            {results.map((r) => (
              <li key={r.record_id}>
                <Link to={`/library/${r.work_id}`} onClick={() => setOpen(false)} className="block rounded-8 p-2 text-body text-fg hover:bg-dim">{r.title}</Link>
              </li>
            ))}
            {!search.isFetching && results.length === 0 && <li className="p-2 text-small text-muted">No matches. Press Enter to search the library.</li>}
            {search.isFetching && <li className="p-2 text-small text-muted">Searching…</li>}
          </ul>
        )}
      </form>
      <Link to="/library/new" className="hidden sm:block"><Button>+ Add to library</Button></Link>
    </header>
  );
}

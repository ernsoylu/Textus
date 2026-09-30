import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLibraryItems } from '@/hooks/useLibrary';
import { useDebounced } from '@/hooks/useDebounced';
import { BookSearchResults } from '@/components/library/BookSearchResults';
import { Button } from '@/components/ui/button';

// Top bar: global search (⌘K / Ctrl+K) and "+ Add to library". Results come from the same
// library_page() RPC as the Library page (FR-SRCH-1); Enter opens them all in the Library.
export function TopBar() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(query.trim());
  const search = useLibraryItems({ limit: 8, enabled: !!debounced && open, filters: { q: debounced, sort: 'relevance' } });
  const results = search.data ?? [];

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
    if (e.key === 'ArrowDown' && e.target === inputRef.current) {
      e.preventDefault();
      e.currentTarget.querySelector<HTMLAnchorElement>('ul a')?.focus();
    }
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-bg p-3">
      <form onSubmit={submit} className="relative flex-1" role="search" onKeyDown={onKeyDown} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
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
          className="w-full rounded-8 bg-dim p-3 text-body text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 text-small text-muted md:block">⌘K</kbd>
        {open && query.trim() && (
          <BookSearchResults items={results} loading={search.isFetching || debounced !== query.trim()} error={search.error?.message} onSelect={() => setOpen(false)} />
        )}
      </form>
      <Link to="/library/new" className="hidden sm:block"><Button>+ Add to library</Button></Link>
    </header>
  );
}

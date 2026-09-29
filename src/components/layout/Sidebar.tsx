import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { SignOutButton } from '@/components/account/SignOutButton';
import { useSavedSearches, useDeleteSavedSearch } from '@/hooks/useSavedSearches';

// Figma: "Navigation / Desktop" (node 8:28), 232px, shown ≥768px per the prototype note in
// "Start here · Textus". "SAVED SEARCHES" (FR-ORG-5) lists the user's real saved_searches rows.
const NAV_ITEMS = [
  { to: '/', label: 'Overview' },
  { to: '/library', label: 'Library' },
  { to: '/collections', label: 'Collections' },
  { to: '/contributors', label: 'Contributors' },
  { to: '/serials', label: 'Serials' },
  { to: '/notes', label: 'Notes' },
  { to: '/import', label: 'Import' },
  { to: '/activity', label: 'Activity' },
  { to: '/settings', label: 'Settings' },
] as const;

export function Sidebar() {
  const { session } = useAuth();
  const saved = useSavedSearches();
  const remove = useDeleteSavedSearch();

  return (
    <nav className="hidden w-[232px] shrink-0 flex-col gap-2 bg-dim p-6 md:flex" aria-label="Main">
      <p className="font-serif text-title text-fg">textus</p>
      <p className="text-small mb-4 text-muted">YOUR PRIVATE LIBRARY</p>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            cn(
              'min-h-11 rounded-8 p-3 text-label',
              isActive ? 'bg-green-bg text-green' : 'text-muted hover:bg-raised/50 hover:text-fg',
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
      {saved.data && saved.data.length > 0 && (
        <div className="mt-4 flex flex-col gap-1">
          <p className="text-small text-muted">SAVED SEARCHES</p>
          {saved.data.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-1">
              <NavLink to={`/library?saved=${s.id}`} className="text-label min-h-11 flex-1 truncate p-3 text-muted hover:text-fg">{s.name}</NavLink>
              <button type="button" aria-label={`Delete saved search ${s.name}`} className="text-small text-muted hover:text-red" onClick={() => remove.mutate(s.id)}>×</button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-auto flex flex-col gap-1 border-t border-border pt-4">
        <p className="text-label truncate text-fg">{session?.user.email ?? 'Signed out'}</p>
        <p className="text-small text-muted">Private · self-hosted</p>
        <div><SignOutButton variant="ghost" /></div>
      </div>
    </nav>
  );
}

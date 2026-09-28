import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

// Figma: "Navigation / Desktop" (node 8:28), 232px, shown ≥768px per the prototype note in
// "Start here · Textus". "SAVED SEARCHES" is FR-ORG-5 (M3, no table yet) — omitted rather
// than shown with fake entries (CLAUDE.md invariant 5).
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
      <div className="mt-auto flex flex-col gap-1 border-t border-border pt-4">
        <p className="text-label truncate text-fg">{session?.user.email ?? 'Signed out'}</p>
        <p className="text-small text-muted">Private · self-hosted</p>
      </div>
    </nav>
  );
}

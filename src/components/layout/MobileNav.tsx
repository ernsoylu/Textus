import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

// Figma: "Navigation / Mobile" (node 8:57), fixed bottom bar, shown <768px (NFR-A11Y-1: 44px+ targets).
const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/library', label: 'Library' },
  { to: '/library/new', label: 'Add' },
  { to: '/notes', label: 'Notes' },
  { to: '/settings', label: 'More' },
] as const;

export function MobileNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 flex items-center bg-dim p-2 md:hidden"
      aria-label="Main"
    >
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            cn(
              'flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-8 p-2 small',
              isActive ? 'text-green' : 'text-muted',
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

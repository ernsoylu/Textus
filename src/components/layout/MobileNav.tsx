import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ModalDialog } from '@/components/ui/ModalDialog';
import { Button } from '@/components/ui/button';

// Figma: "Navigation / Mobile" (node 8:57), fixed bottom bar, shown <768px (NFR-A11Y-1: 44px+ targets).
const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/library', label: 'Library' },
  { to: '/library/new', label: 'Add' },
  { to: '/notes', label: 'Notes' },
] as const;

const MORE_ITEMS = [
  { to: '/collections', label: 'Collections' },
  { to: '/contributors', label: 'Contributors' },
  { to: '/serials', label: 'Serials' },
  { to: '/tags', label: 'Tags' },
  { to: '/import', label: 'Import' },
  { to: '/activity', label: 'Activity' },
  { to: '/settings', label: 'Settings' },
] as const;

export function MobileNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();
  const inMore = MORE_ITEMS.some((item) => pathname.startsWith(item.to));
  return (
    <>
    <nav
      className="fixed inset-x-0 bottom-0 z-10 flex items-center border-t border-border bg-dim p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
      aria-label="Main"
    >
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          aria-current={item.to === '/library' && pathname === '/library/new' ? false : undefined}
          className={({ isActive }) =>
            cn(
              'flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-8 p-2 text-small',
              isActive && !(item.to === '/library' && pathname === '/library/new') ? 'text-green' : 'text-muted',
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
      <button type="button" aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)} className={cn('min-h-11 w-full rounded-8 p-2 text-small', inMore ? 'text-green' : 'text-muted')}>More</button>
    </nav>
    <ModalDialog open={moreOpen} title="Explore your library" onClose={() => setMoreOpen(false)}>
      <nav aria-label="More pages" className="grid grid-cols-2 gap-2">
        {MORE_ITEMS.map((item) => <NavLink key={item.to} to={item.to} onClick={() => setMoreOpen(false)} className={({ isActive }) => cn('min-h-11 rounded-8 p-3 text-label', isActive ? 'bg-green-bg text-green' : 'bg-dim text-fg hover:bg-green-bg')}>{item.label}</NavLink>)}
      </nav>
      <Button variant="secondary" onClick={() => setMoreOpen(false)}>Close</Button>
    </ModalDialog>
    </>
  );
}

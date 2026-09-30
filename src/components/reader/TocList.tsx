import { cn } from '@/lib/utils';
import type { TocItem } from './types';

// The contents sidebar shared by every viewer: nested entries, the current one marked (aria-current).
export function TocList({ items, active, onSelect, depth = 0 }: Readonly<{ items: TocItem[]; active?: string; onSelect: (href: string) => void; depth?: number }>) {
  return (
    <ul className="flex flex-col">
      {items.map((item, i) => (
        <li key={`${item.href}:${i}`}>
          <button
            type="button"
            aria-current={item.href === active ? 'location' : undefined}
            onClick={() => onSelect(item.href)}
            style={{ paddingLeft: `${0.5 + depth * 0.875}rem` }}
            className={cn('w-full rounded-4 py-1.5 pr-2 text-left text-small hover:bg-raised', item.href === active ? 'bg-green-bg text-green' : 'text-fg')}
          >
            {item.label || 'Untitled'}
          </button>
          {!!item.subitems?.length && <TocList items={item.subitems} active={active} onSelect={onSelect} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

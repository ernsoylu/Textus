import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Popover } from '@/components/ui/Popover';
import { Sheet } from './Sheet';

it.each(['sheet', 'popover'])('focuses the requested comment field ahead of other controls in a %s', (kind) => {
  const children = <><button type="button">Earlier control</button><textarea aria-label="Comment" data-autofocus /></>;
  const onClose = vi.fn();
  const { unmount } = render(kind === 'sheet'
    ? <Sheet label="Comment" onClose={onClose}>{children}</Sheet>
    : <Popover at={{ x: 100, y: 100 }} label="Comment" onClose={onClose}>{children}</Popover>);
  expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveFocus();
  unmount();
});

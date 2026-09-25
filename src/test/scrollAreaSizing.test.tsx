import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScrollArea } from '@/components/ui/scroll-area';

afterEach(cleanup);
it('constrains vertical scroll content without intercepting child actions', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const { container } = render(<ScrollArea><button>اختيار المقطع</button></ScrollArea>);
  expect(container.querySelector('[data-radix-scroll-area-viewport]')).toHaveClass('[&>div]:!block');
  expect(screen.getByRole('button', { name: 'اختيار المقطع' })).toBeEnabled();
  vi.unstubAllGlobals();
});

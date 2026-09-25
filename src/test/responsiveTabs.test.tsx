import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

afterEach(cleanup);

it('allows multiline touch-sized tabs without changing selection behavior', () => {
  render(<Tabs defaultValue="first"><TabsList className="grid grid-cols-2">
    <TabsTrigger value="first">تواشيح وابتهالات</TabsTrigger>
    <TabsTrigger value="second">إعدادات التسجيل</TabsTrigger>
  </TabsList><TabsContent value="first">الأول</TabsContent><TabsContent value="second">الثاني</TabsContent></Tabs>);
  expect(screen.getByRole('tablist')).toHaveClass('h-auto', 'min-w-0');
  for (const tab of screen.getAllByRole('tab')) {
    expect(tab).toHaveClass('min-h-11', 'min-w-0', 'whitespace-normal');
    expect(tab).not.toHaveClass('whitespace-nowrap');
  }
  const second = screen.getByRole('tab', { name: 'إعدادات التسجيل' });
  fireEvent.mouseDown(second, { button: 0, ctrlKey: false });
  expect(second).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel')).toHaveTextContent('الثاني');
});

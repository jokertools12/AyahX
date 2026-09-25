import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsSection } from '@/components/SettingsSection';

describe('SettingsSection', () => {
  it('preserves entered data and mounted controls through closing and parent rerenders', () => {
    function Form() {
      const [name, setName] = useState('');
      return <SettingsSection title="إعدادات النص"><input aria-label="الاسم" value={name} onChange={e => setName(e.target.value)} /><input aria-label="مسودة" defaultValue="" /></SettingsSection>;
    }
    const { container, rerender } = render(<Form />);
    const details = container.querySelector('details')!;
    const summary = container.querySelector('summary')!;
    const name = screen.getByLabelText('الاسم');
    const draft = screen.getByLabelText('مسودة');
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    fireEvent.change(name, {target: {value: 'قناتي'}});
    fireEvent.change(draft, {target: {value: 'نص لم يحفظ بعد'}});
    fireEvent.click(summary);
    expect(details.open).toBe(false);
    rerender(<Form />);
    fireEvent.click(summary);
    expect(screen.getByLabelText('الاسم')).toBe(name);
    expect(screen.getByLabelText('مسودة')).toBe(draft);
    expect(name).toHaveValue('قناتي');
    expect(draft).toHaveValue('نص لم يحفظ بعد');
    expect(details.open).toBe(true);
  });

  it('does not submit a surrounding form when opening settings', () => {
    const submit = vi.fn(e => e.preventDefault());
    const {container} = render(<form onSubmit={submit}><SettingsSection title="الإعدادات"><button type="submit">حفظ</button></SettingsSection></form>);
    fireEvent.click(container.querySelector('summary')!);
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'حفظ'}));
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

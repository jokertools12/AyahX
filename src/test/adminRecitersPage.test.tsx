import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminRecitersPage from '@/pages/AdminRecitersPage';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'admin' }, loading: false }) }));
vi.mock('@/components/Layout', () => ({ Layout: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));

afterEach(() => cleanup());

describe('admin reciter inventory page', () => {
  it('shows read-only reciter and riwayah identity data', () => {
    render(<MemoryRouter><AdminRecitersPage /></MemoryRouter>);
    expect(screen.getByText('سجل القرّاء والروايات')).toBeInTheDocument();
    expect(screen.getByText('مشاري راشد العفاسي')).toBeInTheDocument();
    expect(screen.getAllByText('حفص عن عاصم').length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('ابحث عن قارئ أو رواية')).toBeInTheDocument();
  });
});

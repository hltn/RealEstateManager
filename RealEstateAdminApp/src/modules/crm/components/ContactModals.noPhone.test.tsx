/** CallModal / ZaloModal: khách chưa có SĐT (phone null) vẫn render, không in "null" và không lỗi (FR-02). */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CallModal, type ContactTarget } from './CallModal';
import { ZaloModal } from './ZaloModal';

vi.mock('@crm/config/featureFlags', () => ({ CRM_FEATURE_FLAGS: { isInAppCallEnabled: true, isZaloZnsEnabled: true } }));
vi.mock('@crm/api', () => ({ useCatalogs: () => ({ catalogs: { contactResults: [] }, isLoading: false, isError: false, refetch: vi.fn() }) }));

const target = (phone: string | null): ContactTarget => ({ name: 'Nguyễn Văn An', phone, preferredSalutation: '', interestedProjects: [] });

describe('CallModal', () => {
  it('phone null: hiện tên, không hiện chữ "null", không lỗi', () => {
    render(<CallModal customer={target(null)} onClose={vi.fn()} onSaveLog={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Nguyễn Văn An' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/null|undefined/);
  });

  it('có phone: hiện số (đối chứng)', () => {
    render(<CallModal customer={target('0912345678')} onClose={vi.fn()} onSaveLog={vi.fn()} />);
    expect(screen.getByText('0912345678')).toBeInTheDocument();
  });
});

describe('ZaloModal', () => {
  it('phone null: dòng "Gửi tới" chỉ có tên, không ngoặc rỗng/"null"', () => {
    render(<ZaloModal customer={target(null)} onClose={vi.fn()} onSent={vi.fn()} />);
    const line = screen.getByText('Nguyễn Văn An').closest('p');
    expect(line?.textContent).toBe('Gửi tới: Nguyễn Văn An');
    expect(document.body.textContent).not.toMatch(/null|undefined/);
  });

  it('có phone: "Gửi tới: tên (số)" (đối chứng)', () => {
    render(<ZaloModal customer={target('0912345678')} onClose={vi.fn()} onSent={vi.fn()} />);
    expect(screen.getByText('Nguyễn Văn An').closest('p')?.textContent).toBe('Gửi tới: Nguyễn Văn An (0912345678)');
  });
});

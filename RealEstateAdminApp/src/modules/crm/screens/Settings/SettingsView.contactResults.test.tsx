import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { canAccessView } from '../../navigation';
import { SettingsView } from './SettingsView';

vi.mock('@crm/components/CrmModuleTabs', () => ({ CrmModuleTabs: () => null }));
vi.mock('./components/CatalogSection', () => ({ CatalogSection: ({ kind, description }: { kind: string; description: string }) => <div data-testid="catalog">{`${kind}|${description}`}</div> }));
vi.mock('./components/ProjectsCatalogSection', () => ({ ProjectsCatalogSection: () => null }));
vi.mock('./components/ReminderSettingsSection', () => ({ ReminderSettingsSection: () => null }));
vi.mock('./components/TeamsSection', () => ({ TeamsSection: () => null }));
vi.mock('./components/UsersSection', () => ({ UsersSection: () => null }));

describe('SettingsView - tab Kết quả liên hệ (FR-39)', () => {
  it.each(['desktop', 'mobile'] as const)('FR-39: tab "Kết quả liên hệ" có ở bản %s và mở đúng danh mục contactResults', (variant) => {
    render(<SettingsView variant={variant} />);
    const tab = screen.getByRole('tab', { name: 'Kết quả liên hệ' });
    fireEvent.click(tab);
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('catalog')).toHaveTextContent(/^contactResults\|Kết quả liên hệ chọn trong form Ghi chú chăm sóc/);
  });

  it('FR-39: chuyển sang tab khác thì hiện đúng danh mục của tab đó', () => {
    render(<SettingsView variant="desktop" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Kết quả liên hệ' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Nguồn khách' }));
    expect(screen.getByTestId('catalog')).toHaveTextContent(/^leadSources\|/);
  });

  it('FR-39: màn Cài đặt (nơi chứa tab) chỉ Quản trị vào được', () => {
    expect(canAccessView('settings', 'ADMIN')).toBe(true);
    expect(canAccessView('settings', 'MANAGER')).toBe(false);
    expect(canAccessView('settings', 'STAFF')).toBe(false);
  });
});

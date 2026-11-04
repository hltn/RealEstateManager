import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { buildCrmRoute } from './crmRoute';
import { withCrmMenu } from './navigation';

describe('Th9 cờ VITE_CRM_PROTOTYPE tắt -> không có route /crm', () => {
  it('cờ tắt: buildCrmRoute trả null và /crm/today rơi vào route "*" của ứng dụng', () => {
    expect(buildCrmRoute(false)).toBeNull();
    render(
      <MemoryRouter initialEntries={['/crm/today']}>
        <Routes>
          <Route index element={<div>trang chủ</div>} />
          {buildCrmRoute(false)}
          <Route path="*" element={<div>không tìm thấy trang</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('không tìm thấy trang')).toBeInTheDocument();
  });

  it('cờ bật: có route "crm"', () => {
    const route = buildCrmRoute(true);
    expect(route).not.toBeNull();
    expect((route as { props: { path?: string } }).props.path).toBe('crm');
  });
});

describe('Th9 menu CRM theo cờ', () => {
  const items = [{ name: 'Tin tức' }, { name: 'Quản lý khách hàng' }, { name: 'Cài đặt' }];
  const crmSub = [{ name: 'Việc hôm nay', path: '/crm/today' }];

  it('cờ tắt: mục "Quản lý khách hàng" bị ẩn', () => {
    expect(withCrmMenu(items, crmSub, false).map((item) => item.name)).toEqual(['Tin tức', 'Cài đặt']);
  });

  it('cờ bật: giữ mục và gắn submenu theo vai trò', () => {
    const result = withCrmMenu(items, crmSub, true);
    expect(result.map((item) => item.name)).toEqual(['Tin tức', 'Quản lý khách hàng', 'Cài đặt']);
    expect((result[1] as { subItems?: unknown }).subItems).toEqual(crmSub);
  });
});

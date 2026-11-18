import { render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { CardHeading } from './DetailParts';

describe('CardHeading: chỉ khi bật shouldWrapTrailing mới cho khối bên cạnh xuống dòng (F-2)', () => {
  const renderHeading = (props: { shouldWrapTrailing?: boolean } = {}) => {
    render(<CardHeading icon={Activity} title="Nhật ký chăm sóc" as="h3" trailing={<button type="button">Ghi chú</button>} {...props} />);
    const heading = screen.getByRole('heading', { level: 3, name: 'Nhật ký chăm sóc' });
    return { heading, row: heading.closest('div.flex.justify-between') as HTMLElement };
  };

  it('mặc định: giữ một hàng như cũ (KHÔNG flex-wrap, gap-3) và khối bên cạnh nằm cùng hàng', () => {
    const { row } = renderHeading();
    expect(row).not.toHaveClass('flex-wrap');
    expect(row).toHaveClass('gap-3');
    expect(row).toContainElement(screen.getByRole('button', { name: 'Ghi chú' }));
  });

  it('bật shouldWrapTrailing: hàng là flex-wrap, khối bên cạnh vẫn cùng hàng cha, tiêu đề còn min-w-0 để tự co khi một mình quá hẹp', () => {
    const { heading, row } = renderHeading({ shouldWrapTrailing: true });
    expect(row).toHaveClass('flex-wrap');
    expect(row).toContainElement(screen.getByRole('button', { name: 'Ghi chú' }));
    expect(heading.closest('div.min-w-0')).not.toBeNull();
  });
});

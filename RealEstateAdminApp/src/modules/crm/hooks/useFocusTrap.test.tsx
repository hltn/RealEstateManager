import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useFocusTrap } from './useFocusTrap';

const Dialog = ({ onClose }: { onClose: () => void }) => {
  const ref = useFocusTrap<HTMLDivElement>();
  return (
    <div ref={ref} role="dialog" tabIndex={-1}>
      <button type="button" onClick={onClose}>
        Đóng
      </button>
    </div>
  );
};

/** Hàng có nút mở hộp; mở hộp xong "xóa hàng" (gỡ nút mở khỏi DOM) rồi đóng hộp. */
const Harness = ({ keepFallback }: { keepFallback: boolean }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isRowGone, setIsRowGone] = useState(false);
  return (
    <div>
      {keepFallback && <main data-focus-fallback tabIndex={-1} aria-label="Vùng danh sách" />}
      {!isRowGone && (
        <button type="button" onClick={() => setIsOpen(true)}>
          Mở
        </button>
      )}
      {isOpen && (
        <Dialog
          onClose={() => {
            setIsRowGone(true);
            setIsOpen(false);
          }}
        />
      )}
    </div>
  );
};

describe('useFocusTrap - trả tiêu điểm khi đóng hộp', () => {
  it('nút đã mở hộp còn trong DOM thì tiêu điểm về đúng nút đó', () => {
    const Simple = () => {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setIsOpen(true)}>
            Mở
          </button>
          {isOpen && <Dialog onClose={() => setIsOpen(false)} />}
        </div>
      );
    };
    render(<Simple />);
    screen.getByRole('button', { name: 'Mở' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Mở' }));
    expect(screen.getByRole('button', { name: 'Đóng' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(screen.getByRole('button', { name: 'Mở' })).toHaveFocus();
  });

  it('nút đã mở hộp bị gỡ khỏi DOM (hàng vừa bị xóa) thì tiêu điểm vào vùng dự phòng, không rơi về BODY', () => {
    render(<Harness keepFallback />);
    screen.getByRole('button', { name: 'Mở' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Mở' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(screen.getByLabelText('Vùng danh sách')).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });
});

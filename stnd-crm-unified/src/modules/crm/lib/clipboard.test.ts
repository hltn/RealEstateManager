import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyTextToClipboard } from './clipboard';

const setClipboard = (value: unknown) => Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
const setExecCommand = (value: unknown) => Object.defineProperty(document, 'execCommand', { value, configurable: true, writable: true });

describe('copyTextToClipboard', () => {
  beforeEach(() => {
    setClipboard(undefined);
    setExecCommand(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('có navigator.clipboard: ghi đúng chuỗi, trả true, không đụng execCommand', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const execCommand = vi.fn();
    setClipboard({ writeText });
    setExecCommand(execCommand);
    await expect(copyTextToClipboard('KH-000053')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith('KH-000053');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('thiếu navigator.clipboard (http/trình duyệt cũ): dự phòng execCommand("copy") với textarea chứa đúng chuỗi, rồi dọn textarea', async () => {
    let copiedValue = '';
    setExecCommand(
      vi.fn((command: string) => {
        copiedValue = (document.querySelector('textarea') as HTMLTextAreaElement).value;
        return command === 'copy';
      }),
    );
    await expect(copyTextToClipboard('KH-000053')).resolves.toBe(true);
    expect(copiedValue).toBe('KH-000053');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('writeText bị từ chối: vẫn thử dự phòng và trả true nếu execCommand chép được', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) });
    const execCommand = vi.fn().mockReturnValue(true);
    setExecCommand(execCommand);
    await expect(copyTextToClipboard('KH-000053')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('cả hai cách đều hỏng (execCommand trả false): trả false, không ném lỗi, textarea được dọn', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('x')) });
    setExecCommand(vi.fn().mockReturnValue(false));
    await expect(copyTextToClipboard('KH-000053')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('execCommand ném lỗi: trả false, không ném lỗi, textarea được dọn', async () => {
    setExecCommand(
      vi.fn(() => {
        throw new Error('boom');
      }),
    );
    await expect(copyTextToClipboard('KH-000053')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('không có cả clipboard lẫn execCommand: trả false', async () => {
    await expect(copyTextToClipboard('KH-000053')).resolves.toBe(false);
  });

  it('dự phòng trả lại focus cho phần tử đang focus trước đó', async () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    setExecCommand(vi.fn().mockReturnValue(true));
    await copyTextToClipboard('KH-000053');
    expect(button).toHaveFocus();
    button.remove();
  });
});

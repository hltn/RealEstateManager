/**
 * Sao chép chữ vào clipboard, có dự phòng cho ngữ cảnh không an toàn (http, trình duyệt cũ).
 * Luồng: ưu tiên `navigator.clipboard.writeText` (cần https/localhost + quyền); thiếu API hoặc bị từ chối thì
 * dùng `document.execCommand('copy')` qua <textarea> ẩn. Không bao giờ ném lỗi: trả `true` khi đã chép, `false` khi cả hai cách đều hỏng.
 */

/** Dự phòng: chép bằng textarea ẩn + `execCommand('copy')`; khôi phục focus cũ để không mất ngữ cảnh bàn phím. */
const copyWithExecCommand = (text: string): boolean => {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  // readonly + ngoài màn hình: không bật bàn phím ảo trên mobile, không làm trang cuộn/nháy.
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;pointer-events:none;';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    previouslyFocused?.focus({ preventScroll: true });
  }
};

export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Bị từ chối quyền / tài liệu không focus: thử dự phòng bên dưới.
    }
  }
  return copyWithExecCommand(text);
};

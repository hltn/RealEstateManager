import { Types } from 'mongoose';
import { cleanTagName, diffTagIds, normalizeTagName } from './tag.rules';

describe('chuẩn hóa tên thẻ', () => {
  it('"Kế  toán", " ke toan " và "KẾ TOÁN" cùng một khóa so trùng', () => {
    const keys = ['Kế  toán', ' ke toan ', 'KẾ TOÁN'].map(normalizeTagName);
    expect(new Set(keys)).toEqual(new Set(['ke toan']));
  });

  it('đ -> d; giữ nguyên chữ hoa/dấu ở tên hiển thị nhưng gom khoảng trắng', () => {
    expect(normalizeTagName('Đầu tư')).toBe('dau tu');
    expect(cleanTagName('  Đầu   tư  ')).toBe('Đầu tư');
  });

  it('NFKC và bỏ ký tự vô hình: "Ｇｏｌｆ" (chữ rộng) và "Go​lf" (zero-width) trùng "golf"', () => {
    expect(normalizeTagName('Ｇｏｌｆ')).toBe('golf');
    expect(normalizeTagName('Go​lf')).toBe('golf');
    expect(cleanTagName('Go​ lf')).toBe('Go lf');
  });

  it('tên chỉ gồm ký tự vô hình hoặc dấu rời cho khóa rỗng', () => {
    expect(normalizeTagName('​‍ ⁠')).toBe('');
    expect(normalizeTagName('́')).toBe('');
  });

  it('chữ đệm Hangul và ô Braille trống (không thuộc Cf) cũng cho khóa rỗng, và bị bỏ khỏi tên có chữ thật', () => {
    expect(normalizeTagName('ᅟᅠㅤﾠ⠀')).toBe('');
    expect(cleanTagName('Goㅤlf')).toBe('Golf');
  });
});

describe('diffTagIds', () => {
  const a = new Types.ObjectId();
  const b = new Types.ObjectId();
  const c = new Types.ObjectId();

  it('tách thẻ mới gắn và thẻ bị gỡ, không phụ thuộc thứ tự', () => {
    const { added, removed } = diffTagIds([a, b], [c, a]);
    expect(added.map(String)).toEqual([String(c)]);
    expect(removed.map(String)).toEqual([String(b)]);
  });

  it('hai tập như nhau (khác thứ tự) => không có thay đổi', () => {
    expect(diffTagIds([a, b], [b, a])).toEqual({ added: [], removed: [] });
  });
});

import { Types } from 'mongoose';
import { uniqueObjectIds } from './object-id.util';

describe('uniqueObjectIds', () => {
  const a = new Types.ObjectId();
  const b = new Types.ObjectId();

  it('khử trùng theo giá trị (hai instance cùng hex là một) và giữ thứ tự xuất hiện đầu tiên', () => {
    const aCopy = new Types.ObjectId(String(a));
    expect(uniqueObjectIds([b, a, aCopy, b]).map(String)).toEqual([
      String(b),
      String(a),
    ]);
  });

  it('vị trí là lần xuất hiện ĐẦU TIÊN (phần tử đầu là nhóm chính / người thực hiện đầu)', () => {
    const aCopy = new Types.ObjectId(String(a));
    expect(uniqueObjectIds([a, b, aCopy]).map(String)).toEqual([
      String(a),
      String(b),
    ]);
  });

  it('mảng rỗng cho mảng rỗng; không đổi mảng đầu vào', () => {
    expect(uniqueObjectIds([])).toEqual([]);
    const input = [a, a];
    uniqueObjectIds(input);
    expect(input).toHaveLength(2);
  });
});

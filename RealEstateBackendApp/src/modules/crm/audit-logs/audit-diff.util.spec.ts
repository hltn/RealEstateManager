import { Types } from 'mongoose';
import { diffFields } from './audit-diff.util';

describe('diffFields', () => {
  it('chỉ trả các field thực sự đổi, giữ thứ tự theo danh sách field', () => {
    const changes = diffFields(
      { name: 'A', code: 'X', isActive: true },
      { name: 'B', code: 'X', isActive: false },
      ['name', 'code', 'isActive'],
    );
    expect(changes).toEqual([
      { field: 'name', from: 'A', to: 'B' },
      { field: 'isActive', from: true, to: false },
    ]);
  });

  it('không đổi gì thì rỗng', () => {
    expect(diffFields({ a: 1 }, { a: 1 }, ['a'])).toEqual([]);
  });

  it('coi ObjectId cùng giá trị là không đổi, khác giá trị là đổi (lưu dạng chuỗi hex)', () => {
    const same = new Types.ObjectId();
    const other = new Types.ObjectId();
    expect(
      diffFields(
        { areaId: same },
        { areaId: new Types.ObjectId(same.toHexString()) },
        ['areaId'],
      ),
    ).toEqual([]);
    expect(diffFields({ areaId: same }, { areaId: other }, ['areaId'])).toEqual(
      [{ field: 'areaId', from: same.toHexString(), to: other.toHexString() }],
    );
  });

  it('so sánh theo giá trị với mảng: đổi thứ tự/nội dung là đổi, null và undefined coi như nhau', () => {
    expect(
      diffFields({ types: ['a', 'b'] }, { types: ['a', 'c'] }, ['types']),
    ).toEqual([{ field: 'types', from: ['a', 'b'], to: ['a', 'c'] }]);
    expect(diffFields({ note: undefined }, { note: null }, ['note'])).toEqual(
      [],
    );
  });
});

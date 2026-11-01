import { Types } from 'mongoose';
import { rebaseAncestors } from './areas.service';

const id = () => new Types.ObjectId();
const hex = (ids: Types.ObjectId[]) => ids.map((item) => item.toHexString());

describe('rebaseAncestors (chuyển khu vực sang cha mới)', () => {
  it('thay phần tổ tiên phía trên khu vực được chuyển, giữ nguyên đường đi từ nó trở xuống', () => {
    const oldRoot = id();
    const moved = id();
    const middle = id();
    const newRoot = id();
    const newParent = id();

    // Hậu duệ cũ: gốc cũ > moved > middle (cháu của moved).
    const result = rebaseAncestors([oldRoot, moved, middle], moved, [
      newRoot,
      newParent,
    ]);

    expect(hex(result)).toEqual(hex([newRoot, newParent, moved, middle]));
  });

  it('chuyển thành khu vực gốc: tổ tiên mới rỗng, chỉ còn nhánh từ khu vực đó trở xuống', () => {
    const oldRoot = id();
    const moved = id();
    expect(hex(rebaseAncestors([oldRoot, moved], moved, []))).toEqual(
      hex([moved]),
    );
  });
});

import { Types } from 'mongoose';
import { computeTeamIds } from './customer-team-sync.service';

describe('computeTeamIds — teamIds của khách = hợp nhóm của MỌI thành viên chăm sóc', () => {
  const [u1, u2, u3] = [
    new Types.ObjectId(),
    new Types.ObjectId(),
    new Types.ObjectId(),
  ];
  const [a, b, c] = [
    new Types.ObjectId(),
    new Types.ObjectId(),
    new Types.ObjectId(),
  ];

  it('người nhiều nhóm đóng góp tất cả nhóm; nhóm trùng giữa các thành viên chỉ tính một lần', () => {
    const teams = new Map([
      [String(u1), [a, b]],
      [String(u2), [b, c]],
    ]);
    expect(computeTeamIds([u1, u2], teams).map(String).sort()).toEqual(
      [String(a), String(b), String(c)].sort(),
    );
  });

  it('thành viên chưa có nhóm hoặc không còn trong dữ liệu không đóng góp gì', () => {
    const teams = new Map([
      [String(u1), [a]],
      [String(u2), []],
    ]);
    expect(computeTeamIds([u1, u2, u3], teams).map(String)).toEqual([
      String(a),
    ]);
  });

  it('careTeam rỗng → rỗng', () => {
    expect(computeTeamIds([], new Map())).toEqual([]);
  });
});

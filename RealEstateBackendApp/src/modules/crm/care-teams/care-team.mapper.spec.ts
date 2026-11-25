import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { CareRole } from '../customers/customer.constants';
import type { RefMaps } from '../customers/customer-refs.service';
import { toCareTeamResponse } from './care-team.mapper';

const primary = new Types.ObjectId();
const member = new Types.ObjectId();
const deletedUser = new Types.ObjectId();
const addedAt = new Date('2026-01-02T03:04:05.000Z');

const team = [
  { userId: primary, role: CareRole.PRIMARY, addedBy: null, addedAt },
  { userId: member, role: CareRole.MEMBER, addedBy: primary, addedAt },
  { userId: deletedUser, role: CareRole.MEMBER, addedBy: primary, addedAt },
];

const maps: Pick<RefMaps, 'users' | 'userStates'> = {
  users: new Map([
    [String(primary), 'Chính đã nghỉ'],
    [String(member), 'Phụ'],
  ]),
  userStates: new Map([
    [String(primary), { isLocked: true, role: UserRole.MANAGER }],
    [String(member), { isLocked: false, role: UserRole.STAFF }],
  ]),
};

describe('FR-09/FR-18: toCareTeamResponse trả isLocked và role của thành viên', () => {
  it('members[].user có isLocked và role đúng từng người (PRIMARY bị khóa vẫn hiện)', () => {
    const { members } = toCareTeamResponse(team, maps);
    expect(members[0].user).toEqual({
      id: String(primary),
      displayName: 'Chính đã nghỉ',
      isLocked: true,
      role: UserRole.MANAGER,
    });
    expect(members[1].user).toEqual({
      id: String(member),
      displayName: 'Phụ',
      isLocked: false,
      role: UserRole.STAFF,
    });
  });

  it('primary có isLocked đúng; addedBy giữ hợp đồng UserRef cũ (không isLocked, không role)', () => {
    const response = toCareTeamResponse(team, maps);
    expect(response.primary).toEqual({
      id: String(primary),
      displayName: 'Chính đã nghỉ',
      isLocked: true,
    });
    expect(response.members[1].addedBy).toEqual({
      id: String(primary),
      displayName: 'Chính đã nghỉ',
    });
    expect(response.members[0].addedBy).toBeNull();
  });

  it('user bị xóa khỏi DB (userStates có nhưng thiếu id đó) không gây lỗi: role null, không isLocked, tên rỗng', () => {
    const { members } = toCareTeamResponse(team, maps);
    expect(members[2].user).toEqual({
      id: String(deletedUser),
      displayName: '',
      role: null,
    });
    expect(members[2].user).not.toHaveProperty('isLocked');
  });

  it('thiếu hẳn userStates thì không ném lỗi và dùng hợp đồng cũ (role null, không isLocked)', () => {
    const response = toCareTeamResponse(team, { users: maps.users });
    expect(response.members[0].user).toEqual({
      id: String(primary),
      displayName: 'Chính đã nghỉ',
      role: null,
    });
    expect(response.primary).toEqual({
      id: String(primary),
      displayName: 'Chính đã nghỉ',
    });
  });

  it('nhóm rỗng (khách cũ chưa có PRIMARY): members rỗng, primary null', () => {
    expect(toCareTeamResponse([], maps)).toEqual({
      members: [],
      primary: null,
    });
  });
});

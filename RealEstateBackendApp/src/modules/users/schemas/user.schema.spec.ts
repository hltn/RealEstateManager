import { model, Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserSchema } from './user.schema';

/** Model gắn vào schema thật, không cần kết nối DB: chỉ kiểm hook/validator chạy ở `validate()`. */
const UserModel = model('UserSchemaSpec', UserSchema);

const build = (fields: Record<string, unknown>) =>
  new UserModel({
    email: 'a@b.c',
    password: 'x',
    displayName: 'A',
    ...fields,
  });

describe('User schema — cặp trường suy ra (role/teamId) luôn đồng bộ với roles/teamIds', () => {
  it('code cũ chỉ truyền role/teamId → roles=[role], teamIds=[teamId]', async () => {
    const teamId = new Types.ObjectId();
    const user = build({ role: UserRole.STAFF, teamId });
    await user.validate();
    expect(user.roles).toEqual([UserRole.STAFF]);
    expect(user.teamIds.map(String)).toEqual([String(teamId)]);
  });

  it('truyền roles/teamIds → role = role cao nhất (kể cả khi role truyền vào lệch), teamId = nhóm đầu', async () => {
    const [a, b] = [new Types.ObjectId(), new Types.ObjectId()];
    const user = build({
      role: UserRole.EDITOR,
      roles: [UserRole.STAFF, UserRole.MANAGER],
      teamId: b,
      teamIds: [a, b],
    });
    await user.validate();
    expect(user.role).toBe(UserRole.MANAGER);
    expect(String(user.teamId)).toBe(String(a));
  });

  it('không truyền gì: role mặc định EDITOR → roles=[EDITOR], không nhóm', async () => {
    const user = build({});
    await user.validate();
    expect(user.roles).toEqual([UserRole.EDITOR]);
    expect(user.teamId).toBeNull();
    expect(user.teamIds).toEqual([]);
  });

  it('roles trùng hoặc giá trị lạ bị từ chối', async () => {
    await expect(
      build({ roles: [UserRole.STAFF, UserRole.STAFF] }).validate(),
    ).rejects.toThrow(/roles/);
    await expect(build({ roles: ['SUPERUSER'] }).validate()).rejects.toThrow(
      /roles/,
    );
  });
});

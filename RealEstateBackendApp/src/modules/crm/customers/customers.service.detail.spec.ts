import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import {
  buildCustomer,
  buildUserDirectory,
  ctxOf,
  USERS,
} from './access/customer-rights.fixture';
import { CustomersService } from './customers.service';
import type { CustomerLean } from './customers.repository';

/**
 * T-55 (FR-30): `toDetailDto` thêm `ownerManagers` + `creator` qua MỘT `CustomerOwnerTeamService` (cùng nguồn với kiểm
 * tra người thực hiện), chỉ dựng cho khách người gọi đã qua phạm vi.
 */

const emptyRefs = () => ({
  statuses: new Map(),
  sources: new Map(),
  areas: new Map(),
  projects: new Map(),
  contactResults: new Map(),
  tags: new Map(),
  users: new Map(),
  codes: {
    sources: new Map(),
    areas: new Map(),
    projects: new Map(),
    contactResults: new Map(),
  },
});

const build = (
  ownerTeam = buildUserDirectory().ownerTeam,
  refsResolve = jest.fn().mockResolvedValue(emptyRefs()),
) => {
  const service = new CustomersService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { resolve: refsResolve } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    ownerTeam,
  );
  return { service, refsResolve };
};

describe('CustomersService.toDetailDto: ownerManagers và creator (FR-30)', () => {
  it('FR-30: khách do Staff nhóm A tạo: ownerManagers = Manager nhóm A (chưa trong careTeam), creator = null (đã ở careTeam)', async () => {
    const { service } = build();
    const customer = buildCustomer() as unknown as CustomerLean;

    const detail = await service.toDetailDto(customer, ctxOf('ADMIN'));

    expect(detail.ownerManagers).toEqual([
      {
        userId: String(USERS.MANAGER_OWNER.userId),
        fullName: USERS.MANAGER_OWNER.displayName,
        role: UserRole.MANAGER,
      },
    ]);
    expect(detail.creator).toBeNull();
  });

  it('FR-30: người tạo ngoài careTeam (Admin) được trả ở creator', async () => {
    const { service } = build();
    const customer = buildCustomer({
      createdBy: USERS.ADMIN.userId,
    }) as unknown as CustomerLean;

    const detail = await service.toDetailDto(customer, ctxOf('MANAGER_OWNER'));

    expect(detail.creator).toEqual({
      userId: String(USERS.ADMIN.userId),
      fullName: USERS.ADMIN.displayName,
      role: UserRole.ADMIN,
    });
    expect(detail.ownerManagers).toEqual([]);
  });

  it('FR-30: gọi buildOwnerRefs đúng một lần với khách, song song với dịch nhãn (không N+1)', async () => {
    const buildOwnerRefs = jest
      .fn()
      .mockResolvedValue({ ownerManagers: [], creator: null });
    const { service, refsResolve } = build({ buildOwnerRefs } as never);
    const customer = buildCustomer() as unknown as CustomerLean;

    await service.toDetailDto(customer, ctxOf('ADMIN'));

    expect(buildOwnerRefs).toHaveBeenCalledTimes(1);
    expect(buildOwnerRefs).toHaveBeenCalledWith(customer);
    expect(refsResolve).toHaveBeenCalledTimes(1);
  });

  it('FR-30: khách thiếu createdBy (dữ liệu cũ) dự phòng theo teamIds, không lỗi', async () => {
    const { service } = build();
    const customer = buildCustomer({
      createdBy: null,
      teamIds: [new Types.ObjectId()],
    }) as unknown as CustomerLean;

    const detail = await service.toDetailDto(customer, ctxOf('ADMIN'));

    expect(detail.creator).toBeNull();
    expect(Array.isArray(detail.ownerManagers)).toBe(true);
  });
});

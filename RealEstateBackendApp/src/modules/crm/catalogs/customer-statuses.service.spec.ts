import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { ListGroup } from './catalog.enums';
import { CustomerStatusesService } from './customer-statuses.service';

// `applyChanges` là hàm thuần (không đụng DB) nên dựng service với phụ thuộc rỗng.
const service = new CustomerStatusesService(
  null as never,
  null as never,
  null as never,
  null as never,
);

const status = (overrides: Record<string, unknown> = {}) =>
  ({
    _id: 'x',
    code: 'CUSTOM',
    label: 'Tùy chỉnh',
    listGroup: ListGroup.INTERESTED,
    color: null,
    order: 5,
    isDefault: false,
    isSystem: false,
    isActive: true,
    ...overrides,
  }) as never;

const codeOf = (action: () => unknown): string | undefined => {
  try {
    action();
  } catch (error) {
    return (error as BusinessException).errorCode;
  }
  return undefined;
};

describe('CustomerStatusesService.applyChanges — bất biến tình trạng khách', () => {
  it('giữ nguyên field không gửi', () => {
    const next = service.applyChanges(status({ color: 'gray' }), {
      label: 'Mới',
    });
    expect(next).toMatchObject({ label: 'Mới', color: 'gray', order: 5 });
  });

  it('tình trạng hệ thống không đổi được nhóm danh sách => CATALOG_SYSTEM', () => {
    expect(
      codeOf(() =>
        service.applyChanges(status({ isSystem: true }), {
          listGroup: ListGroup.NET,
        }),
      ),
    ).toBe(ErrorCode.CATALOG_SYSTEM);
  });

  it('tình trạng thường đổi nhóm được (khách tự vào danh sách mới)', () => {
    expect(
      service.applyChanges(status(), { listGroup: ListGroup.DROPPED })
        .listGroup,
    ).toBe(ListGroup.DROPPED);
  });

  it('mặc định phải thuộc NOT_CONTACTED: đặt isDefault cho tình trạng nhóm khác bị từ chối', () => {
    expect(
      codeOf(() => service.applyChanges(status(), { isDefault: true })),
    ).toBe(ErrorCode.VALIDATION_FAILED);
    expect(
      service.applyChanges(status({ listGroup: ListGroup.NOT_CONTACTED }), {
        isDefault: true,
      }).isDefault,
    ).toBe(true);
  });

  it('tình trạng mặc định không được bỏ cờ, tắt hoạt động hay chuyển khỏi NOT_CONTACTED', () => {
    const current = status({
      listGroup: ListGroup.NOT_CONTACTED,
      isDefault: true,
    });
    expect(
      codeOf(() => service.applyChanges(current, { isDefault: false })),
    ).toBe(ErrorCode.VALIDATION_FAILED);
    expect(
      codeOf(() => service.applyChanges(current, { isActive: false })),
    ).toBe(ErrorCode.VALIDATION_FAILED);
    expect(
      codeOf(() =>
        service.applyChanges(current, { listGroup: ListGroup.INTERESTED }),
      ),
    ).toBe(ErrorCode.VALIDATION_FAILED);
  });
});

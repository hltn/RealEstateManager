import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateAppointmentDto,
  ListAppointmentsQueryDto,
  UpdateAppointmentDto,
} from './appointment.dto';

const failedProps = async (
  cls: new () => object,
  plain: Record<string, unknown>,
): Promise<string[]> =>
  (await validate(plainToInstance(cls, plain))).map((e) => e.property);

const base = {
  customerId: '66f1a2b3c4d5e6f708192a3b',
  type: 'SITE_VISIT',
  startAt: '2026-10-30T02:00:00.000Z',
};

describe('DTO lịch hẹn: projectCode (FR-40)', () => {
  it.each(['QTERRA', 'qterra', 'VIN-HOMES_1', '  QTERRA  '])(
    'FR-40: CreateAppointmentDto nhận projectCode %p (cắt khoảng trắng, hoa/thường đều được)',
    async (projectCode) => {
      expect(
        await failedProps(CreateAppointmentDto, { ...base, projectCode }),
      ).toEqual([]);
    },
  );

  it.each(['', 'có dấu', 'QT ERRA', 'A'.repeat(31), 'Q$T', 123])(
    'FR-40: CreateAppointmentDto từ chối projectCode %p',
    async (projectCode) => {
      expect(
        await failedProps(CreateAppointmentDto, { ...base, projectCode }),
      ).toEqual(['projectCode']);
    },
  );

  it('FR-40: projectCode null hoặc bỏ trống hợp lệ (không gắn dự án); gửi cùng projectId vẫn hợp lệ ở tầng DTO', async () => {
    expect(
      await failedProps(CreateAppointmentDto, { ...base, projectCode: null }),
    ).toEqual([]);
    expect(await failedProps(CreateAppointmentDto, base)).toEqual([]);
    expect(
      await failedProps(CreateAppointmentDto, {
        ...base,
        projectId: '66f1a2b3c4d5e6f708192a3c',
        projectCode: 'QTERRA',
      }),
    ).toEqual([]);
  });

  it('FR-40: UpdateAppointmentDto nhận projectCode hợp lệ/null, từ chối mã sai định dạng', async () => {
    expect(
      await failedProps(UpdateAppointmentDto, { projectCode: 'QTERRA' }),
    ).toEqual([]);
    expect(
      await failedProps(UpdateAppointmentDto, { projectCode: null }),
    ).toEqual([]);
    expect(
      await failedProps(UpdateAppointmentDto, { projectCode: 'sai mã' }),
    ).toEqual(['projectCode']);
  });

  it('FR-40: ListAppointmentsQueryDto nhận projectCode (cạnh projectId), từ chối mã sai định dạng', async () => {
    const query = { from: '2026-10-01', to: '2026-10-31' };
    expect(
      await failedProps(ListAppointmentsQueryDto, {
        ...query,
        projectCode: 'QTERRA',
      }),
    ).toEqual([]);
    expect(
      await failedProps(ListAppointmentsQueryDto, {
        ...query,
        projectCode: 'sai mã',
      }),
    ).toEqual(['projectCode']);
  });
});

describe('DTO lịch hẹn: assigneeIds (FR-30)', () => {
  const ids = Array.from(
    { length: 21 },
    (_, i) => `66f1a2b3c4d5e6f7081900${String(i).padStart(2, '0')}`,
  );

  it('FR-30: tạo lịch nhận 1 và 20 người, từ chối 0 và 21 người', async () => {
    expect(
      await failedProps(CreateAppointmentDto, {
        ...base,
        assigneeIds: ids.slice(0, 1),
      }),
    ).toEqual([]);
    expect(
      await failedProps(CreateAppointmentDto, {
        ...base,
        assigneeIds: ids.slice(0, 20),
      }),
    ).toEqual([]);
    expect(
      await failedProps(CreateAppointmentDto, { ...base, assigneeIds: [] }),
    ).toEqual(['assigneeIds']);
    expect(
      await failedProps(CreateAppointmentDto, { ...base, assigneeIds: ids }),
    ).toEqual(['assigneeIds']);
  });

  it('FR-30: gửi trùng id được khử trùng GIỮ THỨ TỰ (21 phần tử có trùng vẫn hợp lệ nếu còn ≤ 20)', async () => {
    const dto = plainToInstance(CreateAppointmentDto, {
      ...base,
      assigneeIds: [ids[2], ids[0], ids[2], ids[1], ids[0]],
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.assigneeIds).toEqual([ids[2], ids[0], ids[1]]);

    const many = plainToInstance(CreateAppointmentDto, {
      ...base,
      assigneeIds: [...ids.slice(0, 20), ids[0]],
    });
    expect(await validate(many)).toHaveLength(0);
    expect(many.assigneeIds).toHaveLength(20);
  });

  it.each([
    ['không phải mongo id', ['abc']],
    ['không phải mảng', 'x'],
    ['null', null],
  ])('FR-30: từ chối assigneeIds %s', async (_label, assigneeIds) => {
    expect(
      await failedProps(CreateAppointmentDto, { ...base, assigneeIds }),
    ).toEqual(['assigneeIds']);
  });

  it('FR-30: assigneeId (cũ, deprecated) vẫn hợp lệ, gửi cùng assigneeIds cũng hợp lệ ở tầng DTO', async () => {
    expect(
      await failedProps(CreateAppointmentDto, { ...base, assigneeId: ids[0] }),
    ).toEqual([]);
    expect(
      await failedProps(CreateAppointmentDto, {
        ...base,
        assigneeId: ids[0],
        assigneeIds: [ids[1]],
      }),
    ).toEqual([]);
    expect(
      await failedProps(CreateAppointmentDto, { ...base, assigneeId: 'abc' }),
    ).toEqual(['assigneeId']);
  });

  it('FR-30: không gửi assigneeIds là hợp lệ (service chọn mặc định)', async () => {
    expect(await failedProps(CreateAppointmentDto, base)).toEqual([]);
  });

  it('FR-30: sửa lịch nhận assigneeIds 1..20, từ chối rỗng/quá 20, vẫn nhận assigneeId cũ', async () => {
    expect(
      await failedProps(UpdateAppointmentDto, { assigneeIds: ids.slice(0, 3) }),
    ).toEqual([]);
    expect(
      await failedProps(UpdateAppointmentDto, { assigneeIds: [] }),
    ).toEqual(['assigneeIds']);
    expect(
      await failedProps(UpdateAppointmentDto, { assigneeIds: ids }),
    ).toEqual(['assigneeIds']);
    expect(
      await failedProps(UpdateAppointmentDto, { assigneeId: ids[0] }),
    ).toEqual([]);
  });
});

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

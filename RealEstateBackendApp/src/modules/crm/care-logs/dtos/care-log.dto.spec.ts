import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CareLogNextActionAppointmentDto,
  CreateCareLogDto,
  UpdateCareLogDto,
} from './care-log.dto';

const base = { content: 'Gọi lần 1', contactChannel: 'CALL' };

const errorsOf = async <T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): Promise<string[]> =>
  (await validate(plainToInstance(cls, plain))).map((e) => e.property);

describe('care-log DTO: contactResultCode (FR-40)', () => {
  it('FR-40: tạo nhật ký nhận contactResultCode hợp lệ, có cắt khoảng trắng', async () => {
    const dto = plainToInstance(CreateCareLogDto, {
      ...base,
      contactResultCode: ' KHONG_NGHE_MAY ',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.contactResultCode).toBe('KHONG_NGHE_MAY');
  });

  it('FR-40: tạo nhật ký vẫn nhận contactResultId (cũ) khi không có code', async () => {
    expect(
      await errorsOf(CreateCareLogDto, {
        ...base,
        contactResultId: '66f1a2b3c4d5e6f708192a3b',
      }),
    ).toEqual([]);
  });

  it('FR-40: tạo nhật ký từ chối code sai định dạng (chữ thường, ký tự lạ, quá 30 ký tự) và null', async () => {
    for (const bad of ['khong_nghe_may', 'A-B', 'A'.repeat(31), '', null]) {
      expect(
        await errorsOf(CreateCareLogDto, { ...base, contactResultCode: bad }),
      ).toEqual(['contactResultCode']);
    }
  });

  it('FR-40: sửa nhật ký nhận contactResultCode null để bỏ chọn, từ chối code sai định dạng', async () => {
    expect(
      await errorsOf(UpdateCareLogDto, { contactResultCode: null }),
    ).toEqual([]);
    expect(
      await errorsOf(UpdateCareLogDto, { contactResultCode: 'abc' }),
    ).toEqual(['contactResultCode']);
  });
});

describe('care-log DTO: nextAction.appointment.projectCode (FR-40)', () => {
  it('FR-40: nhận projectCode (kể cả mã cũ chứa "-"), cắt khoảng trắng, và null', async () => {
    const dto = plainToInstance(CareLogNextActionAppointmentDto, {
      type: 'CALLBACK',
      projectCode: ' QTERRA ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.projectCode).toBe('QTERRA');
    for (const ok of ['my-proj_1', null]) {
      expect(
        await errorsOf(CareLogNextActionAppointmentDto, {
          type: 'CALLBACK',
          projectCode: ok,
        }),
      ).toEqual([]);
    }
  });

  it('FR-40: từ chối projectCode sai định dạng, vẫn nhận projectId (cũ) khi không có code', async () => {
    for (const bad of ['', 'A B', 'A'.repeat(31), 123]) {
      expect(
        await errorsOf(CareLogNextActionAppointmentDto, {
          type: 'CALLBACK',
          projectCode: bad,
        }),
      ).toEqual(['projectCode']);
    }
    expect(
      await errorsOf(CareLogNextActionAppointmentDto, {
        type: 'CALLBACK',
        projectId: '66f1a2b3c4d5e6f708192a3b',
      }),
    ).toEqual([]);
  });
});

import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { CrmActor } from '../common/access/crm-actor';
import type { CatalogRef } from '../customers/customer-refs.service';
import { CareLogsService } from './care-logs.service';
import { CareLogLean } from './care-log.mapper';
import { CreateCareLogDto, UpdateCareLogDto } from './dtos/care-log.dto';

const oid = () => new Types.ObjectId();
const customerId = oid().toHexString();

const actor: CrmActor = {
  userId: oid(),
  role: UserRole.STAFF,
  roles: [UserRole.STAFF],
  displayName: 'Hạnh',
  teamId: null,
  teamIds: [],
  managedTeamIds: [],
};
const ctx = { actor, scope: {} } as never;

const refOf = (code: string, label = code): CatalogRef => ({
  id: oid(),
  code,
  label,
});
const noAnswer = refOf('KHONG_NGHE_MAY', 'Không nghe máy');
const interested = refOf('QUAN_TAM', 'Quan tâm');

/** Dựng service với phụ thuộc giả; trả các mock cần soi. */
const build = (stored?: { log: CareLogLean; refs: CatalogRef[] }) => {
  const created: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const careLogModel = {
    create: jest.fn((docs: Array<Record<string, unknown>>) => {
      created.push(docs[0]);
      return Promise.resolve([{ toObject: () => docs[0] }]);
    }),
    findOne: jest.fn(() => {
      const q: Record<string, jest.Mock> = {};
      q.session = jest.fn().mockReturnValue(q);
      q.lean = jest.fn().mockReturnValue(q);
      q.exec = jest.fn().mockResolvedValue(stored?.log ?? null);
      return q;
    }),
    updateOne: jest.fn((_filter: unknown, update: { $set: object }) => {
      updates.push(update.$set as Record<string, unknown>);
      return { exec: () => Promise.resolve({}) };
    }),
  };
  const refs = {
    // Giả lập CustomerRefsService: trả đúng bản ghi danh mục theo id/code người gọi gửi.
    resolveOneForAssign: jest.fn(
      (
        _kind: string,
        input: { id: Types.ObjectId | null; code: string | null },
      ) =>
        Promise.resolve(
          [noAnswer, interested].find(
            (ref) =>
              (input.id && ref.id.equals(input.id)) || ref.code === input.code,
          ) ?? null,
        ),
    ),
    lockAndAssert: jest.fn().mockResolvedValue(undefined),
    resolveByIds: jest.fn((_kind: string, ids: Types.ObjectId[]) =>
      Promise.resolve(
        (stored?.refs ?? []).filter((ref) =>
          ids.some((id) => id && id.equals(ref.id)),
        ),
      ),
    ),
    resolve: jest.fn().mockResolvedValue({
      users: new Map([[String(actor.userId), 'Hạnh']]),
    }),
  };
  const repo = {
    findOne: jest.fn().mockResolvedValue({
      _id: oid(),
      fullName: 'Khách A',
      careTeam: [],
    }),
    updateOne: jest.fn().mockResolvedValue(undefined),
  };
  const attachments = {
    attachToCareLog: jest.fn().mockResolvedValue([]),
    signUrls: jest.fn().mockResolvedValue(new Map()),
    purgeFiles: jest.fn().mockResolvedValue(undefined),
    detachFromCareLog: jest.fn().mockResolvedValue([]),
  };
  const appointmentsWriter = {
    createInSession: jest
      .fn()
      .mockResolvedValue({ appointment: { _id: oid() } }),
  };
  const session = {};
  const connection = {
    transaction: (work: (s: unknown) => Promise<unknown>) => work(session),
  };
  const service = new CareLogsService(
    connection as never,
    careLogModel as never,
    repo as never,
    { resolve: jest.fn().mockResolvedValue(ctx) } as never,
    refs as never,
    attachments as never,
    { record: jest.fn().mockResolvedValue(undefined) } as never,
    { isEnabled: jest.fn().mockReturnValue(true) } as never,
    appointmentsWriter as never,
    { syncFollowUp: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    {} as never,
  );
  return { service, refs, created, updates, careLogModel, appointmentsWriter };
};

const create = (service: CareLogsService, dto: Partial<CreateCareLogDto>) =>
  service.createInSession(
    ctx,
    customerId,
    { content: 'Gọi lần 1', contactChannel: 'CALL', ...dto } as never,
    'WEB',
    {} as never,
  );

const storedLog = (ref: CatalogRef | null, withCode: boolean): CareLogLean =>
  ({
    _id: oid(),
    customerId: new Types.ObjectId(customerId),
    authorId: actor.userId,
    authorName: 'Hạnh',
    occurredAt: new Date('2026-10-20T03:00:00Z'),
    content: 'Nội dung cũ',
    contactChannel: 'CALL',
    contactResultId: ref?.id ?? null,
    ...(withCode && { contactResultCode: ref?.code ?? null }),
    attachments: [],
    nextAction: null,
    source: 'MANUAL',
    editedAt: null,
  }) as unknown as CareLogLean;

describe('CareLogsService: ghi kép contactResultId + contactResultCode (FR-40)', () => {
  describe('tạo nhật ký', () => {
    it('FR-40: chỉ gửi contactResultCode thì ghi cả id lẫn code của cùng bản ghi và khóa ghi theo id đã dịch', async () => {
      const { service, refs, created } = build();

      await create(service, { contactResultCode: 'KHONG_NGHE_MAY' });

      expect(refs.resolveOneForAssign).toHaveBeenCalledWith(
        'contactResult',
        { id: null, code: 'KHONG_NGHE_MAY' },
        'contactResultCode',
        expect.anything(),
      );
      expect(refs.lockAndAssert).toHaveBeenCalledWith(
        { contactResultId: noAnswer.id },
        expect.anything(),
      );
      expect(created[0]).toMatchObject({
        contactResultId: noAnswer.id,
        contactResultCode: 'KHONG_NGHE_MAY',
      });
    });

    it('FR-40: chỉ gửi contactResultId (cũ) thì code được suy ra từ bản ghi danh mục, không phải từ request', async () => {
      const { service, refs, created } = build();

      await create(service, { contactResultId: interested.id.toHexString() });

      expect(refs.resolveOneForAssign).toHaveBeenCalledWith(
        'contactResult',
        { id: interested.id, code: null },
        'contactResultId',
        expect.anything(),
      );
      expect(created[0]).toMatchObject({
        contactResultId: interested.id,
        contactResultCode: 'QUAN_TAM',
      });
    });

    it('FR-40: không chọn kết quả liên hệ thì cả id và code đều null và không đụng danh mục', async () => {
      const { service, refs, created } = build();

      await create(service, {});

      expect(refs.resolveOneForAssign).not.toHaveBeenCalled();
      expect(refs.lockAndAssert).not.toHaveBeenCalled();
      expect(created[0]).toMatchObject({
        contactResultId: null,
        contactResultCode: null,
      });
    });

    it('FR-40: danh mục không hợp lệ (ném 400 từ CustomerRefsService) thì không ghi nhật ký', async () => {
      const { service, refs, created } = build();
      refs.resolveOneForAssign.mockRejectedValueOnce(new Error('400'));

      await expect(
        create(service, { contactResultCode: 'KHONG_CO' }),
      ).rejects.toThrow('400');

      expect(created).toHaveLength(0);
    });
  });

  describe('lịch hẹn tạo kèm (nextAction.appointment) ghi kép dự án', () => {
    const dueAt = '2099-10-30T02:00:00.000Z';
    const withAppointment = (appointment: Record<string, unknown>) => ({
      nextAction: {
        suggestion: 'Gọi lại',
        dueAt,
        appointment: { type: 'CALLBACK', ...appointment },
      } as never,
    });

    it('FR-40: truyền projectCode xuống AppointmentsWriteService cùng projectId (id rỗng thì null)', async () => {
      const { service, appointmentsWriter } = build();

      await create(service, withAppointment({ projectCode: 'QTERRA' }));

      expect(appointmentsWriter.createInSession).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({ projectId: null, projectCode: 'QTERRA' }),
        'WEB',
        expect.anything(),
      );
    });

    it('FR-40: truyền cả projectId (cũ) và projectCode để writer kiểm cùng một dự án', async () => {
      const { service, appointmentsWriter } = build();
      const projectId = oid();

      await create(
        service,
        withAppointment({
          projectId: projectId.toHexString(),
          projectCode: 'QTERRA',
        }),
      );

      expect(appointmentsWriter.createInSession).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({ projectId, projectCode: 'QTERRA' }),
        'WEB',
        expect.anything(),
      );
    });

    it('FR-40: chỉ gửi projectId (PWA cũ) thì projectCode truyền xuống là null để writer tự suy ra từ id', async () => {
      const { service, appointmentsWriter } = build();
      const projectId = oid();

      await create(
        service,
        withAppointment({ projectId: projectId.toHexString() }),
      );

      expect(appointmentsWriter.createInSession).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({ projectId, projectCode: null }),
        'WEB',
        expect.anything(),
      );
    });

    it.each([
      [
        'projectId null kèm projectCode có giá trị',
        { projectId: null, projectCode: 'QTERRA' },
      ],
      [
        'projectCode null kèm projectId có giá trị',
        { projectId: '66f1a2b3c4d5e6f708192a3b', projectCode: null },
      ],
    ])(
      'FR-40: %s thì 400 VALIDATION_FAILED, không tạo lịch hẹn và không ghi nhật ký',
      async (_name, project) => {
        const { service, appointmentsWriter, created } = build();

        await expect(
          create(service, withAppointment(project)),
        ).rejects.toMatchObject({
          response: {
            errorCode: 'VALIDATION_FAILED',
            details: { field: 'projectCode' },
          },
        });

        expect(appointmentsWriter.createInSession).not.toHaveBeenCalled();
        expect(created).toHaveLength(0);
      },
    );

    it('FR-40: projectCode null một mình (không gắn dự án) hợp lệ, truyền xuống null', async () => {
      const { service, appointmentsWriter } = build();

      await create(service, withAppointment({ projectCode: null }));

      expect(appointmentsWriter.createInSession).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({ projectId: null, projectCode: null }),
        'WEB',
        expect.anything(),
      );
    });
  });

  describe('sửa nhật ký', () => {
    const patch = (service: CareLogsService, dto: UpdateCareLogDto) =>
      service.update(
        { sub: String(actor.userId) } as never,
        customerId,
        oid().toHexString(),
        dto,
      );

    it('FR-40: đổi sang contactResultCode khác thì $set cả id lẫn code và khóa ghi bản ghi mới', async () => {
      const { service, refs, updates } = build({
        log: storedLog(noAnswer, true),
        refs: [noAnswer, interested],
      });

      await patch(service, { contactResultCode: 'QUAN_TAM' });

      expect(refs.lockAndAssert).toHaveBeenCalledWith(
        { contactResultId: interested.id },
        expect.anything(),
      );
      expect(updates[0]).toMatchObject({
        contactResultId: interested.id,
        contactResultCode: 'QUAN_TAM',
      });
    });

    it('FR-40: contactResultCode null thì bỏ chọn, xóa cả id lẫn code', async () => {
      const { service, updates } = build({
        log: storedLog(noAnswer, true),
        refs: [noAnswer],
      });

      await patch(service, { contactResultCode: null });

      expect(updates[0]).toMatchObject({
        contactResultId: null,
        contactResultCode: null,
      });
    });

    it('FR-40: gửi lại đúng code đang lưu là không đổi: không ghi, không khóa (sửa nhật ký khi danh mục đã ngừng vẫn được)', async () => {
      const { service, refs, updates } = build({
        log: storedLog(noAnswer, true),
        refs: [noAnswer],
      });

      await patch(service, { contactResultCode: 'KHONG_NGHE_MAY' });

      expect(updates).toHaveLength(0);
      expect(refs.lockAndAssert).not.toHaveBeenCalled();
      expect(refs.resolveOneForAssign).not.toHaveBeenCalled();
    });

    it('FR-40: gửi lại đúng id đang lưu trên bản ghi cũ chưa có code là không đổi', async () => {
      const { service, updates } = build({
        log: storedLog(noAnswer, false),
        refs: [noAnswer],
      });

      await patch(service, { contactResultId: noAnswer.id.toHexString() });

      expect(updates).toHaveLength(0);
    });

    it('FR-40: id đang lưu nhưng code khác bản ghi đó thì không coi là không đổi mà đi qua kiểm tra gán mới', async () => {
      const { service, refs } = build({
        log: storedLog(noAnswer, true),
        refs: [noAnswer, interested],
      });
      refs.resolveOneForAssign.mockRejectedValueOnce(new Error('lệch'));

      await expect(
        patch(service, {
          contactResultId: noAnswer.id.toHexString(),
          contactResultCode: 'QUAN_TAM',
        }),
      ).rejects.toThrow('lệch');
    });

    it('FR-40: một bên null một bên có giá trị thì 400 VALIDATION_FAILED và không ghi', async () => {
      const { service, updates } = build({
        log: storedLog(noAnswer, true),
        refs: [noAnswer],
      });

      await expect(
        patch(service, {
          contactResultId: null,
          contactResultCode: 'QUAN_TAM',
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(updates).toHaveLength(0);
    });

    it('FR-40: response sau sửa trả contactResult { id, code, label }', async () => {
      const { service } = build({
        log: storedLog(noAnswer, true),
        refs: [noAnswer, interested],
      });

      const response = await patch(service, { contactResultCode: 'QUAN_TAM' });

      expect(response.contactResult).toEqual({
        id: String(interested.id),
        code: 'QUAN_TAM',
        label: 'Quan tâm',
      });
    });
  });
});

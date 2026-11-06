import { Types } from 'mongoose';
import { NotificationType } from './notification.constants';
import { NotificationPreferencesService } from './notification-preferences.service';
import { PUSH_CATALOG } from './push/push-catalog';

const USER = new Types.ObjectId().toHexString();

const build = (stored: unknown = null) => {
  const exec = jest.fn().mockResolvedValue(stored);
  const chain = { lean: () => ({ exec }) };
  const model = {
    findOne: jest.fn(() => chain),
    findOneAndUpdate: jest.fn(() => chain),
  };
  return { service: new NotificationPreferencesService(model as never), model };
};

describe('NotificationPreferencesService (T-30)', () => {
  it('GET: chưa lưu gì thì quietHours = null và pushTypes đúng 4 loại theo thứ tự PUSH_CATALOG', async () => {
    const { service } = build(null);
    const result = await service.get(USER);

    expect(result.quietHours).toBeNull();
    expect(result.pushTypes).toHaveLength(4);
    expect(result.pushTypes.map((t) => t.type)).toEqual(
      PUSH_CATALOG.map((e) => e.type),
    );
    expect(Object.keys(result.pushTypes[0]).sort()).toEqual([
      'canDisable',
      'defaultEnabled',
      'description',
      'label',
      'type',
    ]);
  });

  it('PUT hợp lệ: giữ hợp đồng cũ (types + quietHours) và vẫn kèm pushTypes', async () => {
    const { service, model } = build({
      types: {
        [NotificationType.CUSTOMER_ASSIGNED]: { push: false, inApp: true },
      },
      quietHours: { start: '22:00', end: '06:00' },
    });
    const result = await service.update(USER, {
      types: {
        [NotificationType.CUSTOMER_ASSIGNED]: { push: false, inApp: true },
      },
      quietHours: { start: '22:00', end: '06:00' },
    });

    expect(model.findOneAndUpdate).toHaveBeenCalled();
    expect(result.quietHours).toEqual({ start: '22:00', end: '06:00' });
    expect(result.types[NotificationType.CUSTOMER_ASSIGNED].push).toBe(false);
    expect(result.pushTypes).toHaveLength(4);
  });

  it('PUT start = end: 400 và không ghi DB', async () => {
    const { service, model } = build();
    await expect(
      service.update(USER, {
        types: {},
        quietHours: { start: '10:00', end: '10:00' },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('PUT loại thông báo lạ: 400 và không ghi DB', async () => {
    const { service, model } = build();
    await expect(
      service.update(USER, {
        types: { KHONG_TON_TAI: { push: true, inApp: true } },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

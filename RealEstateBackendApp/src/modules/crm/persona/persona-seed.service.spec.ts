import { FeatureFlag } from '../../../shared/feature-flags/feature-flag.service';
import { SEED_PERSONA_FIELDS } from './persona-seed.data';
import { PersonaSeedService } from './persona-seed.service';

/** Model giả đủ cho `ensureSeeded` (chưa có gì -> upsert chèn mới) và ghi lại `seedKey` đã chèn. */
const makeModel = (insertedSeedKeys: string[]) => ({
  exists: jest.fn().mockReturnValue({ exec: () => Promise.resolve(null) }),
  findOne: jest.fn().mockReturnValue({
    select: () => ({ lean: () => ({ exec: () => Promise.resolve(null) }) }),
  }),
  updateOne: jest.fn().mockImplementation((filter: { seedKey: string }) => ({
    exec: () => {
      insertedSeedKeys.push(filter.seedKey);
      return Promise.resolve({ upsertedCount: 1 });
    },
  })),
});

describe('PersonaSeedService', () => {
  const build = (crmEnabled: boolean) => {
    const groupKeys: string[] = [];
    const fieldKeys: string[] = [];
    const featureFlags = {
      isEnabled: jest.fn((flag: FeatureFlag) =>
        flag === FeatureFlag.CRM_ENABLED ? crmEnabled : false,
      ),
    };
    const config = { bumpVersionNow: jest.fn().mockResolvedValue(undefined) };
    const recompute = { run: jest.fn().mockResolvedValue(undefined) };
    const service = new PersonaSeedService(
      makeModel(groupKeys) as never,
      makeModel(fieldKeys) as never,
      featureFlags as never,
      config as never,
      recompute as never,
    );
    return { service, groupKeys, fieldKeys, config, recompute };
  };

  it('seed mặc định có trường property_type với ít nhất một lựa chọn (migration 008 cần)', () => {
    const field = SEED_PERSONA_FIELDS.find(
      (item) => item.key === 'property_type',
    );
    expect(field).toBeDefined();
    expect(field?.options?.length ?? 0).toBeGreaterThan(0);
  });

  it('cờ CRM bật: seedAll chèn PERSONA_FIELD:property_type và kích tính lại', async () => {
    const { service, fieldKeys, config } = build(true);
    await service.onApplicationBootstrap();
    expect(fieldKeys).toContain('PERSONA_FIELD:property_type');
    expect(config.bumpVersionNow).toHaveBeenCalledTimes(1);
  });

  it('cờ CRM tắt: không seed gì (trường property_type sẽ KHÔNG có trong DB)', async () => {
    const { service, groupKeys, fieldKeys } = build(false);
    await service.onApplicationBootstrap();
    expect(groupKeys).toHaveLength(0);
    expect(fieldKeys).toHaveLength(0);
  });
});

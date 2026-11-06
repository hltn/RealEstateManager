import { ensureSeeded } from './ensure-seeded.util';
import { provinceCode, provinceSeedKey, SEED_PROVINCES } from './crm-seed.data';
import { CrmSeedService } from './crm-seed.service';

jest.mock('./ensure-seeded.util', () => ({
  ensureSeeded: jest.fn().mockResolvedValue(true),
}));

describe('CrmSeedService.seedAreas (FR-40)', () => {
  it('FR-40: mỗi tỉnh được seed với doc.code = provinceCode(name)', async () => {
    const lean = { exec: jest.fn().mockResolvedValue(null) };
    const areaModel = {
      findOne: jest.fn().mockReturnValue({
        select: () => ({ lean: () => lean }),
      }),
    };
    const service = new CrmSeedService(
      {} as never,
      {} as never,
      areaModel as never,
      {} as never,
      {} as never,
    );

    await service.seedAll();

    const mocked = jest.mocked(ensureSeeded);
    const areaCalls = mocked.mock.calls.filter(
      ([model]) => model === (areaModel as unknown),
    );
    expect(areaCalls).toHaveLength(34);
    for (const name of SEED_PROVINCES) {
      const call = areaCalls.find(([, key]) => key === provinceSeedKey(name));
      expect(call?.[3].code).toBe(provinceCode(name));
    }
  });
});

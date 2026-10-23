import { NotFoundException } from '@nestjs/common';
import {
  FeatureFlag,
  FeatureFlagService,
} from '../../shared/feature-flags/feature-flag.service';
import { CrmFeatureGuard } from './crm-feature.guard';

const buildGuard = (isEnabled: boolean) => {
  const isEnabledMock = jest.fn().mockReturnValue(isEnabled);
  const flags = { isEnabled: isEnabledMock } as unknown as FeatureFlagService;
  return { guard: new CrmFeatureGuard(flags), isEnabledMock };
};

describe('CrmFeatureGuard', () => {
  it('cờ CRM_ENABLED bật thì cho qua', () => {
    const { guard, isEnabledMock } = buildGuard(true);
    expect(guard.canActivate()).toBe(true);
    expect(isEnabledMock).toHaveBeenCalledWith(FeatureFlag.CRM_ENABLED);
  });

  it('cờ tắt thì trả 404 như route không tồn tại (không lộ CRM ở môi trường chưa công bố)', () => {
    const { guard } = buildGuard(false);
    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });
});

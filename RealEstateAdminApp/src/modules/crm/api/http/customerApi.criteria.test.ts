/** PT-023: `patchCriteria` map `autoStatusChange` (nếu có) qua `toStatusRef`; không có thì giữ nguyên kết quả cũ. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('../../../../api/axios', () => ({ default: { request: (config: unknown) => request(config) } }));

import { patchCriteria } from './customerApi';

const NET = { id: 's-net', code: 'NET', label: 'Net', listGroup: 'INTERESTED', color: 'success' };
const INTERESTED = { id: 's-int', code: 'INTERESTED', label: 'Quan tâm', listGroup: 'INTERESTED', color: null };

beforeEach(() => request.mockReset());

describe('patchCriteria (PT-023)', () => {
  it('có autoStatusChange: map from/to thành StatusRef của FE (color -> tone), version là version SAU CÙNG', async () => {
    request.mockResolvedValue({ data: { data: { progress: 75, version: 9, lastUpdatedAt: 't', autoStatusChange: { from: INTERESTED, to: NET } } } });
    const result = await patchCriteria('c1', 7, { finance: { isDone: true } });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'patch', url: '/crm/customers/c1/criteria', data: { version: 7, finance: { isDone: true } } }));
    expect(result.version).toBe(9);
    expect(result.autoStatusChange?.to).toMatchObject({ id: 's-net', code: 'NET', label: 'Net', listGroup: 'INTERESTED' });
    expect(result.autoStatusChange?.to).toHaveProperty('tone');
    expect(result.autoStatusChange?.to).not.toHaveProperty('color');
    expect(result.autoStatusChange?.from).toMatchObject({ id: 's-int', code: 'INTERESTED', label: 'Quan tâm' });
  });

  it('from = null (không có tình trạng trước) vẫn giữ null', async () => {
    request.mockResolvedValue({ data: { data: { progress: 75, version: 3, lastUpdatedAt: 't', autoStatusChange: { from: null, to: NET } } } });
    expect((await patchCriteria('c1', 1, {})).autoStatusChange?.from).toBeNull();
  });

  it('response cũ (không có autoStatusChange): không thêm field, giữ nguyên progress/version', async () => {
    request.mockResolvedValue({ data: { data: { progress: 50, version: 2, lastUpdatedAt: 't' } } });
    const result = await patchCriteria('c1', 1, {});
    expect(result).toEqual({ progress: 50, version: 2, lastUpdatedAt: 't' });
    expect(result).not.toHaveProperty('autoStatusChange');
  });
});

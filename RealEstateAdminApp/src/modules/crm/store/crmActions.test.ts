import { describe, expect, it, vi } from 'vitest';
import { createCrmActions } from './crmActions';
import type { CrmAction } from './crmReducer';
import { createCrmStore, createSeedDataState } from './crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';

const setup = () => {
  const router = { navigateTo: vi.fn(), goBack: vi.fn() };
  const actions = createCrmActions({ dispatch: vi.fn(), getState: vi.fn(), router } as unknown as Parameters<typeof createCrmActions>[0]);
  return { router, actions };
};

describe('goBack / goBackTo: nút Quay lại/Hủy truyền thẳng làm onClick không được rò sự kiện click thành fallbackPath', () => {
  it('goBack bỏ qua mọi đối số (vd MouseEvent từ onClick={goBack})', () => {
    const { router, actions } = setup();
    (actions.goBack as (...args: unknown[]) => void)({ type: 'click' });
    expect(router.goBack).toHaveBeenCalledTimes(1);
    expect(router.goBack).toHaveBeenCalledWith();
  });

  it('goBackTo chuyển đúng fallbackPath cho cầu nối router', () => {
    const { router, actions } = setup();
    actions.goBackTo('/crm/customers/abc');
    expect(router.goBack).toHaveBeenCalledWith('/crm/customers/abc');
  });
});

/** Actions chạy trên store + reducer THẬT (getState phản ánh đúng state sau mỗi dispatch). */
const setupWithStore = (initialTagIds: string[]) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  store.getState().dispatch({ type: 'filters/set', changes: { tagIds: initialTagIds } });
  const dispatch = vi.fn((action: CrmAction) => store.getState().dispatch(action));
  const actions = createCrmActions({ dispatch, getState: () => store.getState().state, router: { navigateTo: vi.fn(), goBack: vi.fn() } });
  const tagIds = () => store.getState().state.filters.tagIds;
  return { store, dispatch, actions, tagIds };
};

describe('replaceTagInFilters / pruneStaleTagFilters', () => {
  it('replaceTagInFilters thay A bằng B; hoàn tác (bộ lọc chưa bị đổi) khôi phục đúng bộ lọc thẻ trước đó', () => {
    const { dispatch, actions, tagIds } = setupWithStore(['a', 'b']);
    const undo = actions.replaceTagInFilters('a', 'x');
    expect(dispatch).toHaveBeenCalledWith({ type: 'filters/replaceTag', fromTagId: 'a', toTagId: 'x' });
    expect(tagIds()).toEqual(['x', 'b']);
    undo();
    expect(tagIds()).toEqual(['a', 'b']);
  });

  it('hoàn tác KHÔNG đè khi người dùng đã tự đổi bộ lọc thẻ trong lúc chờ API', () => {
    const { dispatch, store, actions, tagIds } = setupWithStore(['a', 'b']);
    const undo = actions.replaceTagInFilters('a', 'x');
    store.getState().dispatch({ type: 'filters/set', changes: { tagIds: ['x', 'b', 'c'] } });
    dispatch.mockClear();
    undo();
    expect(dispatch).not.toHaveBeenCalled();
    expect(tagIds()).toEqual(['x', 'b', 'c']);
  });

  it('A vốn không có trong bộ lọc: lần thay không đổi gì, hoàn tác không dispatch và không đổi bộ lọc', () => {
    const { dispatch, actions, tagIds } = setupWithStore(['b']);
    const undo = actions.replaceTagInFilters('a', 'x');
    expect(tagIds()).toEqual(['b']);
    dispatch.mockClear();
    undo();
    expect(dispatch).not.toHaveBeenCalled();
    expect(tagIds()).toEqual(['b']);
  });

  it('pruneStaleTagFilters dispatch filters/pruneStaleTags với danh sách id còn tồn tại', () => {
    const dispatch = vi.fn();
    const actions = createCrmActions({ dispatch, getState: vi.fn(), router: { navigateTo: vi.fn(), goBack: vi.fn() } });
    actions.pruneStaleTagFilters(['a']);
    expect(dispatch).toHaveBeenCalledWith({ type: 'filters/pruneStaleTags', existingTagIds: ['a'] });
  });
});

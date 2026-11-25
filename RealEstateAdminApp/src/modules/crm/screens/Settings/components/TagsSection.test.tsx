import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../../../stores/auth.store';

/** Máy chủ giả trong bộ nhớ cho `/crm/tags`: dùng hook và `useCrmApi` THẬT để kiểm cả việc danh sách tự làm mới sau khi ghi. */
interface FakeTag {
  id: string;
  label: string;
  category: 'INTEREST' | 'OCCUPATION' | 'OTHER';
  usageCount: number;
  color: string | null;
}
let serverTags: FakeTag[] = [];
const patch = vi.fn();
const del = vi.fn();
const list = vi.fn();
const emptyPage = { data: [], meta: { total: 0, page: 1, limit: 100, totalPages: 1 } };

vi.mock('@crm/api/http/crmHttp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@crm/api/http/crmHttp')>()),
  crmHttp: {
    raw: vi.fn(),
    post: vi.fn(),
    get: vi.fn().mockResolvedValue({}),
    list: (...args: unknown[]) => list(...args),
    patch: (...args: unknown[]) => patch(...args),
    del: (...args: unknown[]) => del(...args),
  },
}));

const showToast = vi.fn();
const dropTagsFromFilters = vi.fn();
const undoReplace = vi.fn();
const replaceTagInFilters = vi.fn();
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ showToast, dropTagsFromFilters, replaceTagInFilters }) }));

import { CrmApiException } from '@crm/api/http/crmErrors';
import { TagsSection } from './TagsSection';

const makeTag = (value: Partial<FakeTag> & Pick<FakeTag, 'id' | 'label'>): FakeTag => ({ category: 'INTEREST', usageCount: 0, color: null, ...value });

const renderSection = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TagsSection />
    </QueryClientProvider>,
  );
};

const signIn = (role: string) => useAuthStore.setState({ accessToken: 't', user: { _id: 'u1', email: 'a@b.vn', displayName: 'An', role, roles: [role] } as never, isInitialized: true });

beforeEach(() => {
  serverTags = [makeTag({ id: 't-golf', label: 'Golf', usageCount: 4, color: 'brand' }), makeTag({ id: 't-gon', label: 'Gôn', usageCount: 2 }), makeTag({ id: 't-bs', label: 'Bác sĩ', category: 'OCCUPATION', usageCount: 7 })];
  list.mockReset().mockImplementation(async (url: string) => (url === '/crm/tags' ? { data: serverTags, meta: { total: serverTags.length, page: 1, limit: 100, totalPages: 1 } } : emptyPage));
  patch.mockReset();
  del.mockReset().mockImplementation(async (url: string) => {
    const id = url.split('/').pop();
    serverTags = serverTags.filter((tag) => tag.id !== id);
  });
  showToast.mockReset();
  dropTagsFromFilters.mockReset();
  undoReplace.mockReset();
  replaceTagInFilters.mockReset().mockReturnValue(undoReplace);
  signIn('ADMIN');
});

describe('TagsSection: quyền (FR-42)', () => {
  it('không phải Quản trị: chỉ báo "Chỉ Quản trị", không gọi API danh sách và không có nút Sửa/Gộp/Xoá', () => {
    signIn('STAFF');
    renderSection();
    expect(screen.getByRole('alert')).toHaveTextContent('Chỉ Quản trị');
    expect(screen.queryByRole('button', { name: /Sửa thẻ|Gộp thẻ|Xoá thẻ/ })).not.toBeInTheDocument();
    // Danh mục chung (`useCrmApi` -> useCatalogs) vẫn tải thẻ theo -usageCount; danh sách quản trị (sort=name) thì không được gọi.
    expect(list).not.toHaveBeenCalledWith('/crm/tags', expect.objectContaining({ params: expect.objectContaining({ sort: 'name' }) }));
  });
});

describe('TagsSection: danh sách', () => {
  it('hiện tên, nhóm và số khách đang gắn của từng thẻ; ô tìm bỏ dấu lọc theo tên', async () => {
    renderSection();
    const golf = (await screen.findByText('Golf')).closest('li') as HTMLElement;
    expect(within(golf).getByText('Sở thích')).toBeInTheDocument();
    expect(within(golf).getByText('4 khách đang gắn')).toBeInTheDocument();
    const doctor = screen.getByText('Bác sĩ').closest('li') as HTMLElement;
    expect(within(doctor).getByText('Nghề nghiệp')).toBeInTheDocument();
    expect(within(doctor).getByText('7 khách đang gắn')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Tìm thẻ'), { target: { value: 'bac si' } });
    expect(screen.getByText('Bác sĩ')).toBeInTheDocument();
    expect(screen.queryByText('Golf')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Tìm thẻ'), { target: { value: 'zzz' } });
    expect(screen.getByText(/Không có thẻ nào khớp/)).toBeInTheDocument();
  });

  it('chưa có thẻ nào: hiện trạng thái rỗng', async () => {
    serverTags = [];
    renderSection();
    expect(await screen.findByText(/Chưa có thẻ nào/)).toBeInTheDocument();
  });
});

describe('TagsSection: đổi tên/nhóm/màu', () => {
  it('chỉ gửi field đổi (tên) và báo đã lưu; danh sách tải lại với tên mới', async () => {
    patch.mockImplementation(async (_url: string, body: { name: string }) => {
      serverTags = serverTags.map((tag) => (tag.id === 't-golf' ? { ...tag, label: body.name } : tag));
      return serverTags[0];
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa thẻ Golf' }));
    fireEvent.change(screen.getByLabelText(/Tên thẻ/), { target: { value: '  Chơi golf ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/crm/tags/t-golf', { name: 'Chơi golf' }));
    expect(await screen.findByText('Chơi golf')).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith({ title: 'Đã lưu thẻ "Chơi golf"' });
  });

  it('đổi nhóm và bỏ màu: gửi category và color null', async () => {
    patch.mockResolvedValue(serverTags[0]);
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa thẻ Golf' }));
    fireEvent.change(screen.getByLabelText('Nhóm'), { target: { value: 'OTHER' } });
    fireEvent.change(screen.getByLabelText('Màu'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/crm/tags/t-golf', { category: 'OTHER', color: null }));
  });

  it('không đổi gì: đóng form, không gọi API', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa thẻ Golf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Sửa thẻ' })).not.toBeInTheDocument());
    expect(patch).not.toHaveBeenCalled();
  });

  it('tên trống: báo lỗi tại chỗ, không gọi API', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa thẻ Golf' }));
    fireEvent.change(screen.getByLabelText(/Tên thẻ/), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Vui lòng nhập tên thẻ.')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it('trùng tên (409): hiện lỗi của máy chủ trong form, form vẫn mở để sửa', async () => {
    patch.mockRejectedValue(new CrmApiException({ statusCode: 409, errorCode: 'CATALOG_DUPLICATED', message: 'Thẻ "Gôn" đã tồn tại.' }));
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa thẻ Golf' }));
    fireEvent.change(screen.getByLabelText(/Tên thẻ/), { target: { value: 'Gôn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Thẻ "Gôn" đã tồn tại.')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Sửa thẻ' })).toBeInTheDocument();
  });

  it('thẻ có màu #RRGGBB cũ: giữ màu đó làm một lựa chọn, lưu tên không vô tình xóa màu', async () => {
    serverTags = [makeTag({ id: 't-hex', label: 'VIP', color: '#3b82f6' })];
    patch.mockResolvedValue(serverTags[0]);
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa thẻ VIP' }));
    expect(screen.getByLabelText('Màu')).toHaveValue('#3b82f6');
    fireEvent.change(screen.getByLabelText(/Tên thẻ/), { target: { value: 'VIP+' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/crm/tags/t-hex', { name: 'VIP+' }));
  });
});

describe('TagsSection: gộp thẻ', () => {
  it('chỉ cho chọn thẻ đích cùng nhóm, không gồm chính nó', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Gộp thẻ Golf' }));
    const options = within(screen.getByLabelText(/Gộp vào thẻ/)).getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['Chọn thẻ đích', 'Gôn']);
  });

  it('chưa chọn thẻ đích: báo lỗi, chưa hỏi xác nhận', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Gộp thẻ Golf' }));
    fireEvent.click(within(screen.getByRole('form', { name: 'Gộp thẻ' })).getByRole('button', { name: 'Gộp thẻ' }));
    expect(await screen.findByText('Vui lòng chọn thẻ đích.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('xác nhận gộp: PATCH chỉ với mergeIntoId; thẻ cũ biến mất khỏi danh sách, khách chuyển sang thẻ đích (usageCount cộng dồn)', async () => {
    patch.mockImplementation(async (_url: string, body: { mergeIntoId: string }) => {
      const source = serverTags.find((tag) => tag.id === 't-golf') as FakeTag;
      serverTags = serverTags.filter((tag) => tag.id !== source.id).map((tag) => (tag.id === body.mergeIntoId ? { ...tag, usageCount: tag.usageCount + source.usageCount } : tag));
      return serverTags.find((tag) => tag.id === body.mergeIntoId);
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Gộp thẻ Golf' }));
    fireEvent.change(screen.getByLabelText(/Gộp vào thẻ/), { target: { value: 't-gon' } });
    fireEvent.click(within(screen.getByRole('form', { name: 'Gộp thẻ' })).getByRole('button', { name: 'Gộp thẻ' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('4 khách đang gắn "Golf" sẽ chuyển sang "Gôn"');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gộp thẻ' }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/crm/tags/t-golf', { mergeIntoId: 't-gon' }));
    await waitFor(() => expect(screen.queryByText('Golf')).not.toBeInTheDocument());
    const target = screen.getByText('Gôn').closest('li') as HTMLElement;
    expect(within(target).getByText('6 khách đang gắn')).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith({ title: 'Đã gộp thẻ "Golf" vào "Gôn"' });
    // Thẻ nguồn đã biến mất: bộ lọc thẻ đang lưu phải thay A bằng B (không gỡ, không hoàn tác).
    expect(replaceTagInFilters).toHaveBeenCalledExactlyOnceWith('t-golf', 't-gon');
    expect(dropTagsFromFilters).not.toHaveBeenCalled();
    expect(undoReplace).not.toHaveBeenCalled();
  });

  it('thay thẻ trong bộ lọc chạy TRƯỚC khi gọi API gộp (API làm mới danh mục ngay khi xong, thay sau sẽ bị dọn thẻ mồ côi gỡ mất A)', async () => {
    patch.mockImplementation(async (_url: string, body: { mergeIntoId: string }) => serverTags.find((tag) => tag.id === body.mergeIntoId));
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Gộp thẻ Golf' }));
    fireEvent.change(screen.getByLabelText(/Gộp vào thẻ/), { target: { value: 't-gon' } });
    fireEvent.click(within(screen.getByRole('form', { name: 'Gộp thẻ' })).getByRole('button', { name: 'Gộp thẻ' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Gộp thẻ' }));

    await waitFor(() => expect(patch).toHaveBeenCalledOnce());
    expect(replaceTagInFilters).toHaveBeenCalledOnce();
    expect(replaceTagInFilters.mock.invocationCallOrder[0]).toBeLessThan(patch.mock.invocationCallOrder[0]);
  });

  it('máy chủ từ chối gộp: giữ thẻ, hiện lỗi trong form gộp', async () => {
    patch.mockRejectedValue(new CrmApiException({ statusCode: 400, errorCode: 'VALIDATION_FAILED', message: 'Chỉ gộp được các thẻ cùng nhóm' }));
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Gộp thẻ Golf' }));
    fireEvent.change(screen.getByLabelText(/Gộp vào thẻ/), { target: { value: 't-gon' } });
    fireEvent.click(within(screen.getByRole('form', { name: 'Gộp thẻ' })).getByRole('button', { name: 'Gộp thẻ' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Gộp thẻ' }));
    expect(await screen.findByText('Chỉ gộp được các thẻ cùng nhóm')).toBeInTheDocument();
    expect(screen.getByText('Golf')).toBeInTheDocument();
    // Gộp lỗi: bộ lọc đã thay lạc quan phải được hoàn tác.
    expect(undoReplace).toHaveBeenCalledOnce();
    expect(dropTagsFromFilters).not.toHaveBeenCalled();
  });
});

describe('TagsSection: xóa mềm', () => {
  it('hỏi xác nhận (nêu số khách bị gỡ thẻ), xác nhận thì DELETE và thẻ biến mất', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá thẻ Bác sĩ' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('gỡ khỏi 7 khách');
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xoá thẻ' }));

    await waitFor(() => expect(del).toHaveBeenCalledWith('/crm/tags/t-bs'));
    await waitFor(() => expect(screen.queryByText('Bác sĩ')).not.toBeInTheDocument());
    expect(showToast).toHaveBeenCalledWith({ title: 'Đã xoá thẻ "Bác sĩ"' });
    expect(dropTagsFromFilters).toHaveBeenCalledExactlyOnceWith(['t-bs']);
  });

  it('huỷ xác nhận: không gọi API', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá thẻ Golf' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Huỷ' }));
    expect(del).not.toHaveBeenCalled();
    expect(screen.getByText('Golf')).toBeInTheDocument();
  });

  it('xóa lỗi: báo lỗi bằng toast, thẻ vẫn còn', async () => {
    del.mockRejectedValue(new CrmApiException({ statusCode: 403, errorCode: 'FORBIDDEN', message: 'Bạn không có quyền.' }));
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá thẻ Golf' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Xoá thẻ' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ type: 'error', title: 'Bạn không có quyền.' }));
    expect(screen.getByText('Golf')).toBeInTheDocument();
    expect(dropTagsFromFilters).not.toHaveBeenCalled();
  });
});

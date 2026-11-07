import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../../../stores/auth.store';

/** Máy chủ giả trong bộ nhớ cho `/crm/persona-fields`: dùng hook và `useCrmApi` THẬT để kiểm cả việc danh sách tự làm mới sau khi ghi. */
interface FakeOption {
  value: string;
  label: string;
  isActive: boolean;
}
interface FakeField {
  id: string;
  key: string;
  label: string;
  groupCode: string;
  type: string;
  options: FakeOption[];
  order: number;
  isSystem: boolean;
  isActive: boolean;
}
let serverFields: FakeField[] = [];
const patch = vi.fn();
const put = vi.fn();
const list = vi.fn();
const emptyPage = { data: [], meta: { total: 0, page: 1, limit: 100, totalPages: 1 } };

vi.mock('@crm/api/http/crmHttp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@crm/api/http/crmHttp')>()),
  crmHttp: {
    raw: vi.fn(),
    post: vi.fn(),
    get: vi.fn().mockResolvedValue({}),
    del: vi.fn(),
    list: (...args: unknown[]) => list(...args),
    patch: (...args: unknown[]) => patch(...args),
    put: (...args: unknown[]) => put(...args),
  },
}));

const showToast = vi.fn();
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ showToast }) }));

import { CrmApiException } from '@crm/api/http/crmErrors';
import { PersonaFieldsSection } from './PersonaFieldsSection';

/** Dựng DTO đầy đủ như `GET /crm/persona-fields` trả về (phần màn quản trị không dùng lấy mặc định). */
const toDto = (field: FakeField) => ({
  helpText: null,
  placeholder: null,
  weight: 1,
  suggestPriority: 1,
  isFilterable: false,
  isOccasion: false,
  occasionLabel: null,
  linkedCriterion: null,
  isSensitive: false,
  ...field,
});

const makeField = (value: Partial<FakeField> & Pick<FakeField, 'id' | 'label' | 'groupCode' | 'order'>): FakeField => ({
  key: value.id,
  type: 'TEXT',
  options: [],
  isSystem: false,
  isActive: true,
  ...value,
});

const initialFields = (): FakeField[] => [
  makeField({ id: 'f-name', label: 'Quê quán', groupCode: 'PERSONAL', order: 1, isSystem: true }),
  makeField({ id: 'f-job', label: 'Nghề phụ', groupCode: 'OCCUPATION', order: 2 }),
  makeField({ id: 'f-hobby', label: 'Sở thích chính', groupCode: 'LIFESTYLE', order: 3 }),
  makeField({ id: 'f-day', label: 'Ngày kỷ niệm', groupCode: 'OCCASION', order: 4, type: 'DATE' }),
  makeField({ id: 'f-kid', label: 'Số con', groupCode: 'FAMILY', order: 5 }),
  makeField({ id: 'f-chan', label: 'Kênh ưa thích', groupCode: 'CONTACT', order: 6 }),
  makeField({
    id: 'f-pt',
    key: 'property_type',
    label: 'Loại hình',
    groupCode: 'REAL_ESTATE',
    order: 7,
    type: 'MULTI_SELECT',
    isSystem: true,
    options: [
      { value: 'APT', label: 'Căn hộ', isActive: true },
      { value: 'VILLA', label: 'Biệt thự', isActive: true },
      { value: 'LAND', label: 'Đất nền', isActive: false },
    ],
  }),
  makeField({ id: 'f-bud', label: 'Mức giá', groupCode: 'REAL_ESTATE', order: 8, type: 'NUMBER_RANGE' }),
];

let queryClient: QueryClient;
const renderSection = () => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PersonaFieldsSection />
    </QueryClientProvider>,
  );
};

const signIn = (role: string) => useAuthStore.setState({ accessToken: 't', user: { _id: 'u1', email: 'a@b.vn', displayName: 'An', role, roles: [role] } as never, isInitialized: true });

/** Giống BE: danh sách gửi lên là danh sách mong muốn, lựa chọn vắng bị TẮT (không xóa). */
const applyPatch = (id: string, body: { label?: string; isActive?: boolean; options?: FakeOption[] }): FakeField => {
  let updated = serverFields[0];
  serverFields = serverFields.map((field) => {
    if (field.id !== id) return field;
    const sent = body.options;
    const options = sent ? [...sent.map((option) => ({ ...option, isActive: true })), ...field.options.filter((old) => !sent.some((option) => option.value === old.value)).map((old) => ({ ...old, isActive: false }))] : field.options;
    updated = { ...field, label: body.label ?? field.label, isActive: body.isActive ?? field.isActive, options };
    return updated;
  });
  return updated;
};

const groupOf = (name: string) => screen.getByRole('region', { name }) as HTMLElement;
const labelsIn = (group: HTMLElement) => within(group).getAllByRole('listitem').map((item) => item.querySelector('p')?.firstChild?.textContent);

beforeEach(() => {
  serverFields = initialFields();
  list.mockReset().mockImplementation(async (url: string) => (url === '/crm/persona-fields' ? { data: serverFields.map(toDto), meta: { total: serverFields.length, page: 1, limit: 100, totalPages: 1 } } : emptyPage));
  patch.mockReset().mockImplementation(async (url: string, body: never) => toDto(applyPatch(url.split('/').pop() as string, body)));
  put.mockReset();
  showToast.mockReset();
  signIn('ADMIN');
});

describe('PersonaFieldsSection: quyền (FR-41)', () => {
  it('không phải Quản trị: chỉ báo "Chỉ Quản trị", không chạy truy vấn quản trị, không có nút Sửa/Chuyển/Bật', () => {
    signIn('STAFF');
    renderSection();
    expect(screen.getByRole('alert')).toHaveTextContent('Chỉ Quản trị mới quản lý được trường chân dung.');
    expect(screen.queryByRole('button', { name: /Sửa trường|Chuyển lên|Chuyển xuống/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    // Danh mục chung vẫn tải `persona-fields` cho form chân dung nên không thể dựa vào số lần gọi URL; kiểm trực tiếp truy vấn quản trị.
    const adminQuery = queryClient.getQueryCache().getAll().find((query) => query.queryKey.includes('admin-persona-fields'));
    expect(adminQuery?.state.dataUpdateCount ?? 0).toBe(0);
    expect(adminQuery?.state.data).toBeUndefined();
  });

  it('MANAGER cũng không được quản lý trường chân dung', () => {
    signIn('MANAGER');
    renderSection();
    expect(screen.getByRole('alert')).toHaveTextContent('Chỉ Quản trị');
    expect(screen.queryByRole('button', { name: /Sửa trường/ })).not.toBeInTheDocument();
  });
});

describe('PersonaFieldsSection: danh sách theo 7 nhóm', () => {
  it('hiện đủ 7 nhóm theo thứ tự chuẩn, mỗi trường nằm đúng nhóm', async () => {
    renderSection();
    await screen.findByText('Quê quán');
    const headings = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(['Cá nhân', 'Nghề nghiệp', 'Sở thích và lối sống', 'Dịp đặc biệt', 'Gia đình và quan hệ', 'Cách liên hệ', 'Nhu cầu BĐS']);
    expect(labelsIn(groupOf('Nhóm Nhu cầu BĐS'))).toEqual(['Loại hình', 'Mức giá']);
    expect(labelsIn(groupOf('Nhóm Cá nhân'))).toEqual(['Quê quán']);
  });

  it('hiện kiểu, nhãn "Hệ thống", số lựa chọn đang dùng/đã tắt; trường đã tắt có nhãn "Đã tắt"', async () => {
    serverFields = serverFields.map((field) => (field.id === 'f-job' ? { ...field, isActive: false } : field));
    renderSection();
    const propertyType = (await screen.findByText('Loại hình')).closest('li') as HTMLElement;
    expect(within(propertyType).getByText('Hệ thống')).toBeInTheDocument();
    expect(within(propertyType).getByText('2 lựa chọn, 1 đã tắt')).toBeInTheDocument();
    const job = screen.getByText('Nghề phụ').closest('li') as HTMLElement;
    expect(within(job).getByText('Đã tắt')).toBeInTheDocument();
    expect(within(job).getByRole('switch', { name: 'Bật trường Nghề phụ' })).toHaveAttribute('aria-checked', 'false');
  });

  it('gọi API với limit 100 (mức tối đa của máy chủ)', async () => {
    renderSection();
    await screen.findByText('Quê quán');
    expect(list).toHaveBeenCalledWith('/crm/persona-fields', expect.objectContaining({ params: expect.objectContaining({ limit: 100 }) }));
  });

  it('lỗi tải: báo lỗi kèm nút Thử lại', async () => {
    // 4xx là kết quả cuối (không tự thử lại) nên lỗi hiện ngay.
    list.mockRejectedValue(new CrmApiException({ statusCode: 403, errorCode: 'INSUFFICIENT_ROLE', message: 'Bạn không có quyền xem' }));
    renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent('Bạn không có quyền xem');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });
});

describe('PersonaFieldsSection: sửa nhãn và lựa chọn (không mất dữ liệu cũ)', () => {
  const openEditor = async (name = 'Loại hình') => {
    fireEvent.click(await screen.findByRole('button', { name: `Sửa trường ${name}` }));
    return screen.getByRole('form', { name: `Sửa trường ${name}` });
  };

  it('tắt một lựa chọn và thêm lựa chọn mới: chỉ gửi lựa chọn ĐANG DÙNG; lựa chọn vắng hiện "Đã tắt" sau khi tải lại, không bị xóa', async () => {
    renderSection();
    const form = await openEditor();
    fireEvent.click(within(form).getByRole('switch', { name: 'Đang dùng lựa chọn Biệt thự' }));
    fireEvent.change(within(form).getByLabelText('Thêm lựa chọn mới'), { target: { value: ' Nhà phố ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Thêm lựa chọn' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Lưu' }));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/crm/persona-fields/f-pt', {
        options: [
          { value: 'APT', label: 'Căn hộ', isActive: true },
          { value: 'NHA_PHO', label: 'Nhà phố', isActive: true },
        ],
      }),
    );
    expect(showToast).toHaveBeenCalledWith({ title: 'Đã lưu trường "Loại hình"' });
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Sửa trường Loại hình' })).not.toBeInTheDocument());
    // Tải lại: 2 đang dùng (Căn hộ, Nhà phố) + 2 đã tắt (Biệt thự, Đất nền) — không lựa chọn nào bị xóa.
    expect(await screen.findByText('2 lựa chọn, 2 đã tắt')).toBeInTheDocument();
    expect(serverFields.find((field) => field.id === 'f-pt')?.options.map((option) => option.value)).toEqual(['APT', 'NHA_PHO', 'VILLA', 'LAND']);
  });

  it('đổi tên lựa chọn: giữ nguyên mã value (dữ liệu khách cũ vẫn khớp)', async () => {
    renderSection();
    const form = await openEditor();
    fireEvent.change(within(form).getByLabelText('Tên lựa chọn 1'), { target: { value: 'Căn hộ cao cấp' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/crm/persona-fields/f-pt', {
        options: [
          { value: 'APT', label: 'Căn hộ cao cấp', isActive: true },
          { value: 'VILLA', label: 'Biệt thự', isActive: true },
        ],
      }),
    );
  });

  it('lựa chọn đã tắt hiện "Đã tắt" và không sửa tên được; nhập lại đúng tên thì BẬT LẠI lựa chọn cũ (cùng mã), không tạo bản trùng', async () => {
    renderSection();
    const form = await openEditor();
    expect(within(form).getByText('Đã tắt')).toBeInTheDocument();
    expect(within(form).getByLabelText('Tên lựa chọn 3')).toBeDisabled();

    fireEvent.change(within(form).getByLabelText('Thêm lựa chọn mới'), { target: { value: 'đat nen' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Thêm lựa chọn' }));
    expect(within(form).queryByText('Đã tắt')).not.toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const sent = patch.mock.calls[0][1].options as FakeOption[];
    expect(sent.map((option) => option.value)).toEqual(['APT', 'VILLA', 'LAND']);
  });

  it('thêm lựa chọn trùng tên lựa chọn đang dùng: báo lỗi tại chỗ, không đổi nháp, không gọi API', async () => {
    renderSection();
    const form = await openEditor();
    fireEvent.change(within(form).getByLabelText('Thêm lựa chọn mới'), { target: { value: 'căn hộ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Thêm lựa chọn' }));
    expect(within(form).getByText('Đã có lựa chọn "Căn hộ".')).toBeInTheDocument();
    expect(within(form).getAllByRole('switch')).toHaveLength(3);
    expect(patch).not.toHaveBeenCalled();
  });

  it('Enter ở ô thêm lựa chọn thêm lựa chọn (không gửi cả form)', async () => {
    renderSection();
    const form = await openEditor();
    fireEvent.change(within(form).getByLabelText('Thêm lựa chọn mới'), { target: { value: 'Nhà phố' } });
    fireEvent.keyDown(within(form).getByLabelText('Thêm lựa chọn mới'), { key: 'Enter' });
    expect(within(form).getByLabelText('Tên lựa chọn 4')).toHaveValue('Nhà phố');
    expect(patch).not.toHaveBeenCalled();
  });

  it('lựa chọn mới thêm trong form bỏ đi được ("Bỏ"), lựa chọn đã có thì chỉ tắt được (không có nút Bỏ)', async () => {
    renderSection();
    const form = await openEditor();
    expect(within(form).queryByRole('button', { name: /Bỏ lựa chọn/ })).not.toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText('Thêm lựa chọn mới'), { target: { value: 'Nhà phố' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Thêm lựa chọn' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Bỏ lựa chọn Nhà phố' }));
    expect(within(form).queryByLabelText('Tên lựa chọn 4')).not.toBeInTheDocument();
  });

  it('tắt hết lựa chọn đang dùng: báo lỗi, không gọi API (BE trả 400 nếu gửi)', async () => {
    renderSection();
    const form = await openEditor();
    fireEvent.click(within(form).getByRole('switch', { name: 'Đang dùng lựa chọn Căn hộ' }));
    fireEvent.click(within(form).getByRole('switch', { name: 'Đang dùng lựa chọn Biệt thự' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Lưu' }));
    expect(await within(form).findByText('Cần ít nhất một lựa chọn đang dùng.')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it('chỉ đổi nhãn trường (TEXT): chỉ gửi label đã cắt khoảng trắng, form không có phần lựa chọn', async () => {
    renderSection();
    const form = await openEditor('Quê quán');
    expect(within(form).queryByText('Lựa chọn')).not.toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText(/Nhãn trường/), { target: { value: '  Nơi sinh ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/crm/persona-fields/f-name', { label: 'Nơi sinh' }));
    expect(await screen.findByText('Nơi sinh')).toBeInTheDocument();
  });

  it('nhãn trống: báo lỗi tại chỗ, không gọi API', async () => {
    renderSection();
    const form = await openEditor('Quê quán');
    fireEvent.change(within(form).getByLabelText(/Nhãn trường/), { target: { value: '   ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Lưu' }));
    expect(await within(form).findByText('Nhãn trường không được để trống.')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it('không đổi gì: đóng form, không gọi API; Huỷ cũng đóng form', async () => {
    renderSection();
    const form = await openEditor();
    fireEvent.click(within(form).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Sửa trường Loại hình' })).not.toBeInTheDocument());
    expect(patch).not.toHaveBeenCalled();

    const again = await openEditor();
    fireEvent.click(within(again).getByRole('button', { name: 'Huỷ' }));
    expect(screen.queryByRole('form', { name: 'Sửa trường Loại hình' })).not.toBeInTheDocument();
  });

  it('máy chủ 409 PERSONA_FIELD_TYPE_LOCKED: giữ form mở và báo theo errorCode (kèm số khách), không phụ thuộc message', async () => {
    patch.mockRejectedValue(new CrmApiException({ statusCode: 409, errorCode: 'PERSONA_FIELD_TYPE_LOCKED', message: 'lời bất kỳ', details: { valueCount: 7 } }));
    renderSection();
    const form = await openEditor('Quê quán');
    fireEvent.change(within(form).getByLabelText(/Nhãn trường/), { target: { value: 'Nơi sinh' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Lưu' }));
    expect(await within(form).findByText('Trường đã có dữ liệu của 7 khách nên không đổi kiểu được. Hãy tạo trường mới.')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Sửa trường Quê quán' })).toBeInTheDocument();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('máy chủ 400 VALIDATION_FAILED: hiện lời máy chủ tại form; sửa tiếp thì lỗi biến mất', async () => {
    patch.mockRejectedValueOnce(new CrmApiException({ statusCode: 400, errorCode: 'VALIDATION_FAILED', message: 'Lựa chọn trùng nhau: "A"' }));
    renderSection();
    const form = await openEditor('Quê quán');
    fireEvent.change(within(form).getByLabelText(/Nhãn trường/), { target: { value: 'Nơi sinh' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Lưu' }));
    expect(await within(form).findByText('Lựa chọn trùng nhau: "A"')).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText(/Nhãn trường/), { target: { value: 'Nơi sinh 2' } });
    expect(within(form).queryByText('Lựa chọn trùng nhau: "A"')).not.toBeInTheDocument();
  });
});

describe('PersonaFieldsSection: bật/tắt trường', () => {
  it('tắt trường: PATCH { isActive: false }, báo đã tắt, danh sách tải lại có nhãn "Đã tắt"', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('switch', { name: 'Bật trường Quê quán' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/crm/persona-fields/f-name', { isActive: false }));
    expect(showToast).toHaveBeenCalledWith({ title: 'Đã tắt trường "Quê quán"' });
    const row = (await screen.findByText('Đã tắt')).closest('li') as HTMLElement;
    expect(within(row).getByText('Quê quán')).toBeInTheDocument();
  });

  it('bật lại trường đã tắt: PATCH { isActive: true }', async () => {
    serverFields = serverFields.map((field) => (field.id === 'f-job' ? { ...field, isActive: false } : field));
    renderSection();
    fireEvent.click(await screen.findByRole('switch', { name: 'Bật trường Nghề phụ' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/crm/persona-fields/f-job', { isActive: true }));
    expect(showToast).toHaveBeenCalledWith({ title: 'Đã bật trường "Nghề phụ"' });
  });

  it('thất bại (404): báo lỗi dạng toast theo errorCode/status, không báo thành công', async () => {
    patch.mockRejectedValue(new CrmApiException({ statusCode: 404, errorCode: 'RESOURCE_NOT_FOUND', message: 'x' }));
    renderSection();
    fireEvent.click(await screen.findByRole('switch', { name: 'Bật trường Quê quán' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', title: expect.stringContaining('không còn tồn tại') })));
    expect(showToast).not.toHaveBeenCalledWith({ title: 'Đã tắt trường "Quê quán"' });
  });
});

describe('PersonaFieldsSection: đổi thứ tự trong nhóm', () => {
  it('chuyển xuống: PUT /crm/persona-fields/order hoán đổi order hai trường kề nhau, danh sách tải lại theo thứ tự mới', async () => {
    put.mockImplementation(async (_url: string, body: { items: { id: string; order: number }[] }) => {
      serverFields = serverFields.map((field) => ({ ...field, order: body.items.find((item) => item.id === field.id)?.order ?? field.order })).sort((left, right) => left.order - right.order);
      return serverFields.map(toDto);
    });
    renderSection();
    await screen.findByText('Loại hình');
    expect(labelsIn(groupOf('Nhóm Nhu cầu BĐS'))).toEqual(['Loại hình', 'Mức giá']);

    fireEvent.click(screen.getByRole('button', { name: 'Chuyển xuống: Loại hình' }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/crm/persona-fields/order', {
        items: [
          { id: 'f-bud', order: 7 },
          { id: 'f-pt', order: 8 },
        ],
      }),
    );
    await waitFor(() => expect(labelsIn(groupOf('Nhóm Nhu cầu BĐS'))).toEqual(['Mức giá', 'Loại hình']));
  });

  it('chuyển lên là phép ngược lại', async () => {
    put.mockResolvedValue([]);
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Chuyển lên: Mức giá' }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/crm/persona-fields/order', {
        items: [
          { id: 'f-bud', order: 7 },
          { id: 'f-pt', order: 8 },
        ],
      }),
    );
  });

  it('trường đầu nhóm không chuyển lên được, trường cuối không chuyển xuống được (nút khóa); nhóm một trường khóa cả hai', async () => {
    renderSection();
    await screen.findByText('Loại hình');
    expect(screen.getByRole('button', { name: 'Chuyển lên: Loại hình' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Chuyển xuống: Mức giá' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Chuyển xuống: Loại hình' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Chuyển lên: Quê quán' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Chuyển xuống: Quê quán' })).toBeDisabled();
    expect(put).not.toHaveBeenCalled();
  });

  it('PUT thất bại: báo lỗi dạng toast', async () => {
    put.mockRejectedValue(new CrmApiException({ statusCode: 403, errorCode: 'INSUFFICIENT_ROLE', message: 'Bạn không có quyền' }));
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Chuyển xuống: Loại hình' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ type: 'error', title: 'Bạn không có quyền' }));
  });
});

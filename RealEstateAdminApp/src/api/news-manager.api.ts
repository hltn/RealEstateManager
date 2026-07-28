import apiAxios from './axios';

/** Cấu hình cronjob từ `GET /news-manager/cron`. */
export interface CronConfig {
  isActive?: boolean;
  frequency?: string;
}

/** Payload lưu cronjob — `POST /news-manager/cron`. */
export interface SaveCronConfigPayload {
  isActive: boolean;
  frequency: string;
}

/** Một mục prompt AI trong ai-prompts.json. */
export interface PromptConfig {
  api_ai_name: string;
  api_ai_path: string;
  prompt: string;
}

/** Response GET prompts — backend bọc trong `{ success, data }`. */
interface PromptsListResponse {
  success?: boolean;
  data?: PromptConfig[];
}

/** Response PUT prompts — backend trả `{ success, message }`. */
interface SavePromptsResponse {
  success?: boolean;
  message?: string;
}

/**
 * Lấy cấu hình cron — `GET /news-manager/cron`.
 * Dùng cho React Query `useQuery(['cronjob','config'])`.
 */
export async function getCronConfig(signal?: AbortSignal): Promise<CronConfig> {
  const { data } = await apiAxios.get<CronConfig>('/news-manager/cron', {
    signal,
  });
  return data;
}

/** Lưu cấu hình cron — `POST /news-manager/cron`. */
export async function saveCronConfig(payload: SaveCronConfigPayload): Promise<void> {
  await apiAxios.post('/news-manager/cron', payload);
}

/**
 * Lấy danh sách AI prompts — `GET /news-manager/prompts`.
 * Dùng cho React Query `useQuery(['ai','prompts'])`.
 */
export async function fetchPrompts(signal?: AbortSignal): Promise<PromptConfig[]> {
  const { data } = await apiAxios.get<PromptsListResponse>(
    '/news-manager/prompts',
    { signal },
  );
  if (data.success && Array.isArray(data.data)) {
    return data.data;
  }
  return [];
}

/** Lưu danh sách AI prompts — `PUT /news-manager/prompts`. */
export async function savePrompts(prompts: PromptConfig[]): Promise<void> {
  const { data } = await apiAxios.put<SavePromptsResponse>(
    '/news-manager/prompts',
    prompts,
  );
  if (!data.success) {
    throw new Error(data.message || 'Lỗi lưu dữ liệu');
  }
}

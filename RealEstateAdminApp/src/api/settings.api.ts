import apiAxios from './axios';

/** Cấu hình AI tổng hợp từ `GET /settings/ai-config`. */
export interface AiConfigResponse {
  apiKey?: string;
  provider?: string;
  model?: string;
  must1cApiKey?: string;
  must1cModel?: string;
  activePlatform?: string;
}

/** Một model của OpenRouter (chỉ lấy field cần thiết để render select). */
export interface OpenRouterModel {
  id: string;
  name?: string;
}

/** Response danh sách model từ `GET /settings/openrouter-models` (hỗ trợ cả 2 shape). */
export interface OpenRouterModelsResponse {
  models?: OpenRouterModel[];
  data?: OpenRouterModel[];
}

/** Payload lưu cấu hình AI — `POST /settings/ai-config` (gửi từng phần tử tùy ý). */
export interface SaveAiConfigPayload {
  apiKey?: string;
  provider?: string;
  model?: string;
  must1cApiKey?: string;
  must1cModel?: string;
  activePlatform?: string;
}

/**
 * Lấy cấu hình AI hiện tại — `GET /settings/ai-config`.
 * Dùng cho React Query `useQuery(['ai','config'])`.
 */
export async function getAiConfig(signal?: AbortSignal): Promise<AiConfigResponse> {
  const { data } = await apiAxios.get<AiConfigResponse>('/settings/ai-config', {
    signal,
  });
  return data;
}

/**
 * Lấy danh sách model OpenRouter — `GET /settings/openrouter-models`.
 * Dùng cho React Query `useQuery(['ai','models'])`.
 */
export async function getOpenRouterModels(
  signal?: AbortSignal,
): Promise<OpenRouterModel[]> {
  const { data } = await apiAxios.get<OpenRouterModelsResponse>(
    '/settings/openrouter-models',
    { signal },
  );
  return data.models ?? data.data ?? [];
}

/** Lưu cấu hình AI — `POST /settings/ai-config` (gửi field cần đổi). */
export async function saveAiConfig(payload: SaveAiConfigPayload): Promise<void> {
  await apiAxios.post('/settings/ai-config', payload);
}

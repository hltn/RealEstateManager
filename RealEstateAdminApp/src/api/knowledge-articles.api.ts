import apiAxios from './axios';
import type { PaginatedResponse } from '../types/pagination';

// ── Knowledge Article State ──────────────────────────────

export enum KnowledgeArticleState {
  PENDING = 'pending',
  GENERATING_CONTENT = 'generating_content',
  CONTENT_READY = 'content_ready',
  GENERATING_IMAGE = 'generating_image',
  READY = 'ready',
  PUBLISHING = 'publishing',
  PUBLISHED = 'published',
  FAILED = 'failed',
}

// ── Knowledge Article ────────────────────────────────────

export interface KnowledgeArticle {
  _id: string;
  title?: string;
  content?: string;
  htmlContent?: string;
  summary?: string;
  status?: string | string[];
  pipelineState: KnowledgeArticleState | null;
  pipelineError?: string | null;
  pipelineFailedStep?: number | null;
  wpCategoryId?: number | null;
  wpTagIds?: number[];
  wpPostId?: number | null;
  featuredImageUrl?: string | null;
  inlineImageUrls?: string[];
  categorySlug?: string | null;
  batchId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
}

// ── Config Types ─────────────────────────────────────────

export interface CategoryMapping {
  slug: string;
  wpCategoryId: number;
  wpCategoryName: string;
}

export interface TagMapping {
  name: string;
  wpTagId: number;
}

export interface WpConfig {
  siteUrl: string;
  username: string;
  appPassword: string;
  defaultCategoryId: number;
  categoryMapping: CategoryMapping[];
  defaultTagIds: number[];
  tagMapping: TagMapping[];
}

export interface AiWritingTopic {
  slug: string;
  name: string;
  description: string;
}

export interface AiWritingConfig {
  promptTemplate: string;
  model: string;
  provider: string;
  maxTokens: number;
  temperature: number;
  topics: AiWritingTopic[];
  articlesPerBatch: number;
}

export interface AiImageConfig {
  enabled: boolean;
  promptTemplate: string;
  model: string;
  provider: string;
  width: number;
  height: number;
  style: string;
}

export interface KnowledgeCronConfig {
  isActive: boolean;
  frequency: string;
  nlDescription: string;
  parsedCron: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

// ── Pipeline Types ───────────────────────────────────────

export enum PipelineRunStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PARTIAL = 'partial',
}

export interface ArticleResult {
  articleId: string;
  title: string;
  state: string;
  error?: string;
  failedStep?: number;
  wpPostId?: number;
  duration: number;
}

export interface PipelineStep {
  step: number;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PipelineLog {
  _id: string;
  batchId: string;
  categorySlug: string;
  source: 'cron' | 'manual';
  status: PipelineRunStatus;
  totalArticles: number;
  publishedCount: number;
  failedCount: number;
  readyCount: number;
  articleResults: ArticleResult[];
  steps: PipelineStep[];
  totalDuration: number;
  errorSummary: string | null;
  createdAt: string;
}

export interface PipelineStatus {
  status: 'pending' | 'running' | 'done' | 'error';
  currentStep: number;
  steps: PipelineStep[];
  result?: {
    batchId: string;
    published: number;
    failed: number;
    category: string;
  };
  error?: string;
}

export interface NlParseResult {
  cronExpression: string;
  explanation: string;
  schedule: {
    frequency: string;
    time: string;
    timezone: string;
  };
}

// ── Payload Types ────────────────────────────────────────

export interface UpdateWpConfigPayload {
  siteUrl?: string;
  username?: string;
  appPassword?: string;
  defaultCategoryId?: number;
  categoryMapping?: CategoryMapping[];
  defaultTagIds?: number[];
  tagMapping?: TagMapping[];
}

export interface UpdateAiWritingPayload {
  promptTemplate?: string;
  model?: string;
  provider?: string;
  maxTokens?: number;
  temperature?: number;
  topics?: AiWritingTopic[];
  articlesPerBatch?: number;
}

export interface UpdateAiImagePayload {
  enabled?: boolean;
  promptTemplate?: string;
  model?: string;
  provider?: string;
  width?: number;
  height?: number;
  style?: string;
}

export interface UpdateCronPayload {
  isActive?: boolean;
  frequency?: string;
  nlDescription?: string;
}

export interface ActivateSchedulePayload {
  cronExpression: string;
  nlDescription: string;
}

export interface ListParams {
  page?: number;
  limit?: number;
  status?: string;
  category?: string;
  search?: string;
  sort?: 'newest' | 'oldest';
}

// ── Config API ───────────────────────────────────────────

const KB_PREFIX = '/knowledge-articles';

export async function getWpConfig(signal?: AbortSignal): Promise<WpConfig> {
  const { data } = await apiAxios.get<{ data: WpConfig }>(`${KB_PREFIX}/config/wp`, { signal });
  return data.data;
}

export async function saveWpConfig(payload: UpdateWpConfigPayload): Promise<void> {
  await apiAxios.put(`${KB_PREFIX}/config/wp`, payload);
}

export async function verifyWpConnection(): Promise<{ valid: boolean; siteName?: string; error?: string }> {
  const { data } = await apiAxios.post<{ data: { valid: boolean; siteName?: string; error?: string } }>(
    `${KB_PREFIX}/config/wp/verify`,
  );
  return data.data;
}

export async function getAiWritingConfig(signal?: AbortSignal): Promise<AiWritingConfig> {
  const { data } = await apiAxios.get<{ data: AiWritingConfig }>(`${KB_PREFIX}/config/ai-writing`, { signal });
  return data.data;
}

export async function saveAiWritingConfig(payload: UpdateAiWritingPayload): Promise<void> {
  await apiAxios.put(`${KB_PREFIX}/config/ai-writing`, payload);
}

export async function getAiImageConfig(signal?: AbortSignal): Promise<AiImageConfig> {
  const { data } = await apiAxios.get<{ data: AiImageConfig }>(`${KB_PREFIX}/config/ai-image`, { signal });
  return data.data;
}

export async function saveAiImageConfig(payload: UpdateAiImagePayload): Promise<void> {
  await apiAxios.put(`${KB_PREFIX}/config/ai-image`, payload);
}

export async function getKnowledgeCronConfig(signal?: AbortSignal): Promise<KnowledgeCronConfig> {
  const { data } = await apiAxios.get<{ data: KnowledgeCronConfig }>(`${KB_PREFIX}/config/cron`, { signal });
  return data.data;
}

export async function saveKnowledgeCronConfig(payload: UpdateCronPayload): Promise<void> {
  await apiAxios.put(`${KB_PREFIX}/config/cron`, payload);
}

// ── Articles API ─────────────────────────────────────────

export async function getKnowledgeArticles(
  params: ListParams,
  signal?: AbortSignal,
): Promise<PaginatedResponse<KnowledgeArticle>> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.append('page', String(params.page));
  if (params.limit) searchParams.append('limit', String(params.limit));
  if (params.status) searchParams.append('status', params.status);
  if (params.category) searchParams.append('category', params.category);
  if (params.search) searchParams.append('search', params.search);
  if (params.sort) searchParams.append('sort', params.sort);

  const { data } = await apiAxios.get<PaginatedResponse<KnowledgeArticle>>(
    `${KB_PREFIX}?${searchParams.toString()}`,
    { signal },
  );
  return data;
}

export async function getKnowledgeArticle(id: string, signal?: AbortSignal): Promise<KnowledgeArticle> {
  const { data } = await apiAxios.get<{ data: KnowledgeArticle }>(`${KB_PREFIX}/${id}`, { signal });
  return data.data;
}

export async function retryArticle(id: string): Promise<void> {
  await apiAxios.post(`${KB_PREFIX}/${id}/retry`);
}

export async function publishArticle(id: string): Promise<{ wpPostId: number }> {
  const { data } = await apiAxios.post<{ data: { wpPostId: number } }>(`${KB_PREFIX}/${id}/publish`);
  return data.data;
}

export async function republishArticle(id: string): Promise<{ wpPostId: number }> {
  const { data } = await apiAxios.post<{ data: { wpPostId: number } }>(`${KB_PREFIX}/${id}/republish`);
  return data.data;
}

export async function deleteKnowledgeArticle(id: string): Promise<void> {
  await apiAxios.delete(`${KB_PREFIX}/${id}`);
}

export async function bulkDeleteKnowledgeArticles(ids: string[]): Promise<void> {
  await apiAxios.post(`${KB_PREFIX}/bulk/delete`, { ids });
}

export async function bulkPublishKnowledgeArticles(ids: string[]): Promise<{ jobId?: string }> {
  const { data } = await apiAxios.post<{ jobId?: string }>(`${KB_PREFIX}/bulk/publish`, { ids });
  return data;
}

// ── Pipeline API ─────────────────────────────────────────

export async function startPipeline(params?: {
  category?: string;
  articleCount?: number;
}): Promise<{ jobId: string }> {
  const { data } = await apiAxios.post<{ jobId: string }>(`${KB_PREFIX}/pipeline/run`, params ?? {});
  return data;
}

export async function getPipelineStatus(jobId: string, signal?: AbortSignal): Promise<PipelineStatus> {
  const { data } = await apiAxios.get<PipelineStatus>(`${KB_PREFIX}/pipeline/${jobId}`, { signal });
  return data;
}

export async function retryFailedArticles(jobId: string): Promise<void> {
  await apiAxios.post(`${KB_PREFIX}/pipeline/${jobId}/retry-failed`);
}

export async function testImageGeneration(): Promise<{ imageUrl: string }> {
  const { data } = await apiAxios.post<{ data: { imageUrl: string } }>(
    `${KB_PREFIX}/config/ai-image/test`,
  );
  return data.data;
}

export async function getPipelineLogs(
  params: ListParams,
  signal?: AbortSignal,
): Promise<PaginatedResponse<PipelineLog>> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.append('page', String(params.page));
  if (params.limit) searchParams.append('limit', String(params.limit));
  if (params.status) searchParams.append('status', params.status);
  if (params.category) searchParams.append('category', params.category);

  const { data } = await apiAxios.get<PaginatedResponse<PipelineLog>>(
    `${KB_PREFIX}/pipeline/logs?${searchParams.toString()}`,
    { signal },
  );
  return data;
}

export async function getPipelineLogDetail(batchId: string, signal?: AbortSignal): Promise<PipelineLog> {
  const { data } = await apiAxios.get<{ data: PipelineLog }>(`${KB_PREFIX}/pipeline/logs/${batchId}`, { signal });
  return data.data;
}

// ── NL Cron API ──────────────────────────────────────────

export async function parseNlSchedule(description: string): Promise<NlParseResult> {
  const { data } = await apiAxios.post<{ data: NlParseResult }>(`${KB_PREFIX}/cron/parse-nl`, {
    description,
  });
  return data.data;
}

export async function previewSchedule(cronExpression: string): Promise<{ nextRuns: string[] }> {
  const { data } = await apiAxios.post<{ data: { nextRuns: string[] } }>(`${KB_PREFIX}/cron/preview`, {
    cronExpression,
  });
  return data.data;
}

export async function activateSchedule(payload: ActivateSchedulePayload): Promise<void> {
  await apiAxios.put(`${KB_PREFIX}/cron/activate`, payload);
}

export async function testRunPipeline(params?: {
  category?: string;
  articleCount?: number;
}): Promise<{ jobId: string }> {
  const { data } = await apiAxios.post<{ jobId: string }>(`${KB_PREFIX}/cron/test-run`, params ?? {});
  return data;
}

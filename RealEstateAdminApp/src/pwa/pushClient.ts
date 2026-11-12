/**
 * Phần chạm trình duyệt của Web Push (T-40, FR-09, FR-01): đọc trạng thái thiết bị, đăng ký/hủy `PushSubscription`.
 * Quy tắc cứng: KHÔNG tự xin quyền; `Notification.requestPermission()` chỉ được gọi từ `enablePush`, mà `enablePush` chỉ được gọi từ thao tác bấm.
 * Gọi API server nằm ở hook `usePushSubscription` (file này không biết HTTP).
 */
import { readInstallEnvironment } from './iosInstallHintLogic';
import {
  isSameKey,
  resolveDeviceState,
  urlBase64ToUint8Array,
  type PushCapabilities,
  type PushDeviceState,
  type PushPermission,
} from './pushDeviceState';
import type { PushSubscriptionBody } from '../modules/crm/api/http/pushApi';

/** Lỗi nghiệp vụ phía client để UI hiện thông điệp phù hợp. */
export type PushClientErrorCode = 'NO_SERVICE_WORKER' | 'PERMISSION_NOT_GRANTED' | 'INVALID_SUBSCRIPTION';

export class PushClientError extends Error {
  readonly code: PushClientErrorCode;

  constructor(code: PushClientErrorCode, message: string) {
    super(message);
    this.name = 'PushClientError';
    this.code = code;
  }
}

const getRegistration = async (): Promise<ServiceWorkerRegistration | undefined> => {
  if (!('serviceWorker' in navigator)) return undefined;
  try {
    return await navigator.serviceWorker.getRegistration();
  } catch {
    return undefined;
  }
};

const readPermission = (): PushPermission => ('Notification' in window ? Notification.permission : 'default');

/** Ảnh chụp trạng thái hiện tại: state + subscription (nếu có) để nơi gọi dùng lại, không đọc hai lần. */
export interface DeviceSnapshot {
  state: PushDeviceState;
  subscription: PushSubscription | null;
}

export const readDeviceSnapshot = async (): Promise<DeviceSnapshot> => {
  const registration = await getRegistration();
  const capabilities: PushCapabilities = {
    hasServiceWorker: Boolean(registration),
    hasPushManager: 'PushManager' in window && Boolean(registration?.pushManager),
    hasNotification: 'Notification' in window,
    permission: readPermission(),
  };
  const subscription = capabilities.hasPushManager ? await registration!.pushManager.getSubscription() : null;
  const state = resolveDeviceState({ install: readInstallEnvironment(), capabilities, hasSubscription: Boolean(subscription) });
  return { state, subscription };
};

/** `PushSubscription.toJSON()` -> thân `POST /push-subscriptions`; thiếu endpoint/khóa thì ném (không gửi dữ liệu hỏng lên server). */
export const toSubscriptionBody = (subscription: PushSubscription): PushSubscriptionBody => {
  const json = subscription.toJSON();
  const { p256dh, auth } = json.keys ?? {};
  if (!json.endpoint || !p256dh || !auth) throw new PushClientError('INVALID_SUBSCRIPTION', 'Trình duyệt trả đăng ký thông báo không đầy đủ.');
  return { endpoint: json.endpoint, keys: { p256dh, auth }, expirationTime: json.expirationTime ?? null };
};

export interface EnablePushResult {
  subscription: PushSubscription;
  /** `true` nếu subscription do lần gọi này tạo mới (để hoàn tác khi server từ chối). */
  isNew: boolean;
}

/**
 * Bật thông báo trên thiết bị này. PHẢI gọi trực tiếp từ handler bấm nút (iOS yêu cầu xin quyền trong cử chỉ người dùng),
 * nên `requestPermission` là thao tác bất đồng bộ ĐẦU TIÊN, trước mọi `await` khác.
 * Luồng: xin quyền -> lấy service worker -> dùng lại subscription cũ nếu khóa VAPID khớp (khác khóa thì hủy rồi đăng ký lại,
 * nếu không `subscribe` ném `InvalidStateError`) -> `pushManager.subscribe({ userVisibleOnly: true })`.
 */
export const enablePush = async (publicKey: string): Promise<EnablePushResult> => {
  const permissionRequest = Notification.requestPermission();
  const registrationRequest = getRegistration();
  const permission = await permissionRequest;
  if (permission !== 'granted') throw new PushClientError('PERMISSION_NOT_GRANTED', 'Chưa được cấp quyền thông báo.');

  const registration = await registrationRequest;
  if (!registration) throw new PushClientError('NO_SERVICE_WORKER', 'Ứng dụng chưa sẵn sàng nhận thông báo, hãy tải lại trang rồi thử lại.');

  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  const existing = await registration.pushManager.getSubscription();
  if (existing && isSameKey(existing.options.applicationServerKey, applicationServerKey)) return { subscription: existing, isNew: false };
  if (existing) await existing.unsubscribe();

  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  return { subscription, isNew: true };
};

/** Hủy subscription của trình duyệt (nếu có). Trả `true` khi đã hủy. */
export const unsubscribeLocalPush = async (): Promise<boolean> => {
  const registration = await getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  return subscription ? subscription.unsubscribe() : false;
};

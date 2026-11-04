import { createContext } from 'react';
import type { CrmActions } from './crmActions';
import type { CrmStore } from './crmStore';

/** Store Zustand đang dùng (mặc định = store chung; test/story có thể truyền store riêng qua CrmProvider). */
export const CrmStoreContext = createContext<CrmStore | null>(null);
export const CrmActionsContext = createContext<CrmActions | null>(null);

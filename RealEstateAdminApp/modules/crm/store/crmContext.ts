import { createContext } from 'react';
import type { CrmActions } from './crmActions';
import type { CrmState } from './crmReducer';

export const CrmStateContext = createContext<CrmState | null>(null);
export const CrmActionsContext = createContext<CrmActions | null>(null);

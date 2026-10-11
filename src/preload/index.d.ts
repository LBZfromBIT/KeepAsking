import type { BranchChatApi } from '../shared/types';

declare global {
  interface Window {
    api: BranchChatApi;
  }
}

export {};

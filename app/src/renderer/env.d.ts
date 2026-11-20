import type { SsrApi } from '../shared/ipc';

declare global {
  interface Window {
    ssr: SsrApi;
  }
}

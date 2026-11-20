// sandbox preload: contextBridge로 허용 경로 invoke 1개만 노출한다. ipcRenderer는 노출하지 않는다.
import { contextBridge, ipcRenderer } from 'electron';
import { INVOKE_CHANNEL, failure, isInvokePath, type InvokeResult, type SsrApi } from '../shared/ipc';

const api: SsrApi = {
  invoke(path: string, input?: unknown): Promise<InvokeResult> {
    if (!isInvokePath(path)) return Promise.resolve(failure('E_VALIDATION'));
    return ipcRenderer.invoke(INVOKE_CHANNEL, path, input) as Promise<InvokeResult>;
  },
};

contextBridge.exposeInMainWorld('ssr', api);

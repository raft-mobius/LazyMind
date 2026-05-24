import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../main/ipc/registry';
import type { LazyMindDesktopAPI, ServiceStatus } from '../shared/types';

const api: LazyMindDesktopAPI = {
  getDataDir: () => ipcRenderer.invoke(IPC_CHANNELS.DATA_GET_DIR),
  pickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_PICK_FOLDER),
  openPath: (path: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_PATH, path),
  exportDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_EXPORT),
  getServiceStatus: (name: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SERVICE_GET_STATUS, name),
  getAllServiceStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.SERVICE_GET_ALL_STATUS),
  getCurrentAssistant: () =>
    ipcRenderer.invoke(IPC_CHANNELS.ASSISTANT_GET_CURRENT),
  setCurrentAssistant: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ASSISTANT_SET_CURRENT, id),
  getAssistantList: () =>
    ipcRenderer.invoke(IPC_CHANNELS.ASSISTANT_GET_LIST),
  getVersion: () => '0.1.0',
  isPackaged: () => false,
  getMode: () => 'desktop',
  onServiceStatusChanged: (callback: (status: ServiceStatus) => void) => {
    const handler = (_event: unknown, status: ServiceStatus) => callback(status);
    ipcRenderer.on(IPC_CHANNELS.SERVICE_STATUS_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SERVICE_STATUS_CHANGED, handler);
    };
  },
  setCredential: (service: string, account: string, secret: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_SET, service, account, secret),
  getCredential: (service: string, account: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_GET, service, account),
  deleteCredential: (service: string, account: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_DELETE, service, account),
  listCredentials: (service: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CREDENTIAL_LIST, service),
};

contextBridge.exposeInMainWorld('lazymind', api);

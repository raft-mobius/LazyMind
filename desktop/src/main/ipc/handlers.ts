import { dialog, shell } from 'electron';
import { secureHandle, validatePath } from './security';
import { IPC_CHANNELS } from './registry';
import { getDataDir } from '../data-dir';
import { exportDiagnostics } from '../diagnostics';
import type { ServiceStatus } from '../../shared/types';

let getServiceStatusFn: ((name: string) => ServiceStatus | null) | null = null;
let getAllServiceStatusFn: (() => ServiceStatus[]) | null = null;
let getCurrentAssistantFn: (() => Promise<unknown>) | null = null;
let setCurrentAssistantFn: ((id: string) => Promise<void>) | null = null;
let getAssistantListFn: (() => Promise<unknown[]>) | null = null;

export function setServiceStatusProvider(
  getSingle: (name: string) => ServiceStatus | null,
  getAll: () => ServiceStatus[]
): void {
  getServiceStatusFn = getSingle;
  getAllServiceStatusFn = getAll;
}

export function setAssistantProvider(
  getCurrent: () => Promise<unknown>,
  setCurrent: (id: string) => Promise<void>,
  getList: () => Promise<unknown[]>
): void {
  getCurrentAssistantFn = getCurrent;
  setCurrentAssistantFn = setCurrent;
  getAssistantListFn = getList;
}

export function registerIPCHandlers(): void {
  secureHandle(IPC_CHANNELS.DATA_GET_DIR, () => {
    return getDataDir();
  });

  secureHandle(IPC_CHANNELS.DIALOG_PICK_FOLDER, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  secureHandle(IPC_CHANNELS.SHELL_OPEN_PATH, async (_event, ...args) => {
    const targetPath = args[0] as string;
    const dirs = getDataDir();
    const allowedPrefixes = [dirs.root, dirs.logs, dirs.diagnostics];
    const validated = validatePath(targetPath, allowedPrefixes);
    await shell.openPath(validated);
  });

  secureHandle(IPC_CHANNELS.APP_GET_VERSION, () => {
    const { app } = require('electron');
    return app.getVersion();
  });

  secureHandle(IPC_CHANNELS.APP_IS_PACKAGED, () => {
    const { app } = require('electron');
    return app.isPackaged;
  });

  secureHandle(IPC_CHANNELS.APP_GET_MODE, () => {
    return 'desktop';
  });

  secureHandle(IPC_CHANNELS.SERVICE_GET_STATUS, (_event, ...args) => {
    const name = args[0] as string;
    return getServiceStatusFn?.(name) || null;
  });

  secureHandle(IPC_CHANNELS.SERVICE_GET_ALL_STATUS, () => {
    return getAllServiceStatusFn?.() || [];
  });

  secureHandle(IPC_CHANNELS.ASSISTANT_GET_CURRENT, async () => {
    return getCurrentAssistantFn?.() || null;
  });

  secureHandle(IPC_CHANNELS.ASSISTANT_SET_CURRENT, async (_event, ...args) => {
    const id = args[0] as string;
    await setCurrentAssistantFn?.(id);
  });

  secureHandle(IPC_CHANNELS.ASSISTANT_GET_LIST, async () => {
    return getAssistantListFn?.() || [];
  });

  secureHandle(IPC_CHANNELS.DIAGNOSTICS_EXPORT, async () => {
    const statuses = getAllServiceStatusFn?.() || [];
    return exportDiagnostics(statuses);
  });

  secureHandle(IPC_CHANNELS.LOGS_OPEN, async () => {
    const dirs = getDataDir();
    await shell.openPath(dirs.logs);
  });
}

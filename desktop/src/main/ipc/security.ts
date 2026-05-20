import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import path from 'path';
import { SECURITY_CONFIG } from '../security/config';

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

export function secureHandle(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
): void {
  if (
    !(SECURITY_CONFIG.allowedChannels as readonly string[]).includes(channel)
  ) {
    throw new Error(`IPC channel not in allowlist: ${channel}`);
  }

  ipcMain.handle(channel, (event, ...args) => {
    const senderURL = event.senderFrame?.url || '';
    if (!isAllowedOrigin(senderURL)) {
      throw new Error(`IPC call from unauthorized origin: ${senderURL}`);
    }

    if (mainWindow && event.sender.id !== mainWindow.webContents.id) {
      throw new Error('IPC call from unauthorized window');
    }

    return handler(event, ...args);
  });
}

function isAllowedOrigin(url: string): boolean {
  if (!url) return false;
  return SECURITY_CONFIG.allowedOrigins.some(
    (origin) => url === origin || url.startsWith(origin + '/')
  );
}

export function validatePath(
  targetPath: string,
  allowedPrefixes: string[]
): string {
  const normalized = path.resolve(targetPath);

  const hasTraversal = targetPath.includes('..');
  if (hasTraversal) {
    const segments = targetPath.replace(/\\/g, '/').split('/');
    if (segments.includes('..')) {
      throw new Error(`Path traversal detected: ${targetPath}`);
    }
  }

  const isWithinAllowed = allowedPrefixes.some((prefix) => {
    const normalizedPrefix = path.resolve(prefix);
    return (
      normalized === normalizedPrefix ||
      normalized.startsWith(normalizedPrefix + path.sep)
    );
  });

  if (!isWithinAllowed) {
    throw new Error(
      `Path outside allowed directories: ${targetPath}`
    );
  }

  return normalized;
}

import { app } from 'electron';

let cleanupCallbacks: Array<() => Promise<void>> = [];

export function registerCleanup(callback: () => Promise<void>): void {
  cleanupCallbacks.push(callback);
}

export function setupLifecycle(): void {
  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', async (event) => {
    if (cleanupCallbacks.length === 0) return;

    event.preventDefault();
    const callbacks = [...cleanupCallbacks];
    cleanupCallbacks = [];

    await Promise.allSettled(
      callbacks.map((cb) => cb())
    );

    app.quit();
  });
}

export function acquireSingleInstanceLock(): boolean {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }

  app.on('second-instance', () => {
    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const win = windows[0];
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  return true;
}

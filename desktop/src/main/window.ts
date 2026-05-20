import { BrowserWindow, app, shell } from 'electron';
import path from 'path';
import { SECURITY_CONFIG } from './security/config';
import { PROTOCOL_SCHEME } from '../shared/constants';
import { getRendererURL } from './protocol';

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function createSplashWindow(): BrowserWindow {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const splashPath = path.join(__dirname, 'resources', 'splash.html');

  splashWindow.loadFile(splashPath);
  return splashWindow;
}

export function createMainWindow(preloadPath: string): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    webPreferences: {
      ...SECURITY_CONFIG.browserWindow,
      preload: preloadPath,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (
      !url.startsWith(`${PROTOCOL_SCHEME}://`) &&
      !url.startsWith('http://localhost:') &&
      !url.startsWith('http://127.0.0.1:')
    ) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow!.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const url = getRendererURL();
  mainWindow.loadURL(url);

  return mainWindow;
}

export function closeSplashWindow(): void {
  if (splashWindow) {
    splashWindow.close();
    splashWindow = null;
  }
}

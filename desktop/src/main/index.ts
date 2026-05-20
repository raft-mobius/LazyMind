import { app, protocol, Menu } from 'electron';
import path from 'path';
import { PROTOCOL_SCHEME, PROXY_PORT, PROXY_HOST } from '../shared/constants';
import { acquireSingleInstanceLock, registerCleanup, setupLifecycle } from './lifecycle';
import { registerProtocol, setRendererDir } from './protocol';
import { ensureDataDir, getDataDir } from './data-dir';
import { initLogger, logger, closeAllLoggers } from './logger';
import { registerIPCHandlers, setServiceStatusProvider, setAssistantProvider } from './ipc/handlers';
import { setMainWindow } from './ipc/security';
import { createSplashWindow, createMainWindow } from './window';
import { createProcessManager, getServiceConfigs } from './process-manager';
import { createProxyServer, generateLocalSecret, getDefaultRoutes } from './proxy';
import { createAssistantManager } from './assistant-manager';

protocol.registerSchemesAsPrivileged([
  {
    scheme: PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

async function bootstrap(): Promise<void> {
  if (!acquireSingleInstanceLock()) return;

  setupLifecycle();

  await app.whenReady();

  Menu.setApplicationMenu(null);

  const isDevMode = !!process.env.LAZYMIND_DEV_MODE;

  // Initialize data directory
  await ensureDataDir();
  const dirs = getDataDir();

  // Initialize logger
  initLogger(dirs.logs);
  logger.info('electron-main', `LazyMind Desktop starting... (dev=${isDevMode})`);

  // Register custom protocol
  const rendererDir = process.env.ELECTRON_RENDERER_DIR
    || path.join(__dirname, '..', 'renderer');
  setRendererDir(rendererDir);
  registerProtocol();

  // Show splash window
  createSplashWindow();

  // Generate local secret and configure proxy
  const localSecret = generateLocalSecret();
  const proxyServer = createProxyServer({
    port: PROXY_PORT,
    host: PROXY_HOST,
    routes: getDefaultRoutes(),
    localSecret,
    allowedOrigins: ['lazymind://app', 'http://localhost:5173'],
  });

  // Start proxy
  await proxyServer.start();
  logger.info('electron-main', `Proxy started on ${PROXY_HOST}:${PROXY_PORT}`);

  // Register IPC handlers
  registerIPCHandlers();

  let processManager: ReturnType<typeof createProcessManager> | null = null;

  if (!isDevMode) {
    // Production: start backend processes via process manager
    const binDir = app.isPackaged
      ? path.join(process.resourcesPath, 'bin')
      : path.join(__dirname, '..', 'bin');

    const serviceConfigs = getServiceConfigs(dirs.root, localSecret, binDir);
    processManager = createProcessManager(serviceConfigs);

    setServiceStatusProvider(
      (name) => processManager!.getInfo(name),
      () => processManager!.getAllInfo()
    );

    await processManager.startAll();
    logger.info('electron-main', 'All backend services started');

    // Broadcast service status changes to renderer
    processManager.onStateChange((info) => {
      const { BrowserWindow } = require('electron');
      const wins = BrowserWindow.getAllWindows();
      for (const win of wins) {
        win.webContents.send('service:statusChanged', info);
      }
    });
  } else {
    logger.info('electron-main', 'Dev mode: skipping process manager (start services externally)');
  }

  // Initialize assistant manager (talks to auth-service)
  const assistantManager = createAssistantManager(proxyServer);
  await assistantManager.initialize();

  // Wire assistant IPC
  setAssistantProvider(
    async () => assistantManager.getCurrent(),
    async (id) => assistantManager.setCurrent(id),
    async () => assistantManager.getList()
  );

  // Resolve preload script path
  const preloadPath = path.join(__dirname, 'preload.js');

  // Create main window
  const mainWin = createMainWindow(preloadPath);
  setMainWindow(mainWin);

  // Register cleanup
  registerCleanup(async () => {
    logger.info('electron-main', 'Shutting down...');
    if (processManager) {
      await processManager.stopAll();
    }
    await proxyServer.stop();
    closeAllLoggers();
  });

  logger.info('electron-main', 'LazyMind Desktop ready');
}

bootstrap().catch((err) => {
  console.error('Failed to start LazyMind Desktop:', err);
  app.quit();
});

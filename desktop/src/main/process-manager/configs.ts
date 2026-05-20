import type { ProcessConfig } from '../../shared/types';
import { SERVICE_PORTS, PROCESS_CONFIG } from '../../shared/constants';

export function getServiceConfigs(
  dataDirRoot: string,
  localSecret: string,
  binDir: string
): ProcessConfig[] {
  const sqliteBase = `${dataDirRoot}/data`;

  return [
    {
      name: 'auth-service',
      executablePath: `${binDir}/python`,
      args: ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(SERVICE_PORTS.authService)],
      env: {
        LAZYMIND_DATABASE_URL: `sqlite:///${sqliteBase}/auth.db`,
        LAZYMIND_MODE: 'desktop',
        LAZYMIND_STATE_BACKEND: 'memory',
        LAZYMIND_JWT_SECRET: localSecret,
        LAZYMIND_LOCAL_SECRET: localSecret,
        LAZYMIND_BOOTSTRAP_ADMIN_USERNAME: 'astronomer',
        LAZYMIND_BOOTSTRAP_ADMIN_DISPLAY_NAME: '天文学家',
      },
      healthCheck: {
        type: 'http',
        endpoint: `http://127.0.0.1:${SERVICE_PORTS.authService}/api/authservice/auth/health`,
        intervalMs: PROCESS_CONFIG.healthCheckIntervalMs,
        timeoutMs: PROCESS_CONFIG.healthCheckTimeoutMs,
        retries: 3,
      },
      port: SERVICE_PORTS.authService,
      dependsOn: [],
      startupTimeout: PROCESS_CONFIG.startupTimeoutMs,
      restartPolicy: 'on-failure',
      maxRestarts: PROCESS_CONFIG.maxRestarts,
    },
    {
      name: 'core',
      executablePath: `${binDir}/core.exe`,
      args: [],
      env: {
        ACL_DB_DRIVER: 'sqlite',
        ACL_DB_DSN: `${sqliteBase}/main.db`,
        LAZYMIND_STATE_BACKEND: 'memory',
        LAZYMIND_MODE: 'desktop',
        LAZYMIND_JWT_SECRET: localSecret,
        SERVER_PORT: String(SERVICE_PORTS.core),
        SERVER_HOST: '127.0.0.1',
        LAZYMIND_LOCAL_SECRET: localSecret,
      },
      healthCheck: {
        type: 'http',
        endpoint: `http://127.0.0.1:${SERVICE_PORTS.core}/health`,
        intervalMs: PROCESS_CONFIG.healthCheckIntervalMs,
        timeoutMs: PROCESS_CONFIG.healthCheckTimeoutMs,
        retries: 3,
      },
      port: SERVICE_PORTS.core,
      dependsOn: ['auth-service'],
      startupTimeout: PROCESS_CONFIG.startupTimeoutMs,
      restartPolicy: 'on-failure',
      maxRestarts: PROCESS_CONFIG.maxRestarts,
    },
    {
      name: 'scan-control-plane',
      executablePath: `${binDir}/scan-control-plane.exe`,
      args: [],
      env: {
        DATABASE_DRIVER: 'sqlite',
        DATABASE_DSN: `${sqliteBase}/scan.db`,
        LAZYMIND_LOCAL_SECRET: localSecret,
        SERVER_HOST: '127.0.0.1',
        SERVER_PORT: String(SERVICE_PORTS.scanControlPlane),
      },
      healthCheck: {
        type: 'http',
        endpoint: `http://127.0.0.1:${SERVICE_PORTS.scanControlPlane}/health`,
        intervalMs: PROCESS_CONFIG.healthCheckIntervalMs,
        timeoutMs: PROCESS_CONFIG.healthCheckTimeoutMs,
        retries: 3,
      },
      port: SERVICE_PORTS.scanControlPlane,
      dependsOn: ['core'],
      startupTimeout: PROCESS_CONFIG.startupTimeoutMs,
      restartPolicy: 'on-failure',
      maxRestarts: PROCESS_CONFIG.maxRestarts,
    },
    {
      name: 'file-watcher',
      executablePath: `${binDir}/file-watcher.exe`,
      args: [],
      env: {
        LAZYMIND_LOCAL_SECRET: localSecret,
        SERVER_HOST: '127.0.0.1',
        SERVER_PORT: String(SERVICE_PORTS.fileWatcher),
      },
      healthCheck: {
        type: 'http',
        endpoint: `http://127.0.0.1:${SERVICE_PORTS.fileWatcher}/health`,
        intervalMs: PROCESS_CONFIG.healthCheckIntervalMs,
        timeoutMs: PROCESS_CONFIG.healthCheckTimeoutMs,
        retries: 3,
      },
      port: SERVICE_PORTS.fileWatcher,
      dependsOn: ['scan-control-plane'],
      startupTimeout: PROCESS_CONFIG.startupTimeoutMs,
      restartPolicy: 'on-failure',
      maxRestarts: PROCESS_CONFIG.maxRestarts,
    },
    {
      name: 'algorithm-mock',
      executablePath: `${binDir}/algorithm-mock.exe`,
      args: [],
      env: {
        LAZYMIND_LOCAL_SECRET: localSecret,
        SERVER_HOST: '127.0.0.1',
        SERVER_PORT: String(SERVICE_PORTS.algorithmMock),
      },
      healthCheck: {
        type: 'http',
        endpoint: `http://127.0.0.1:${SERVICE_PORTS.algorithmMock}/health`,
        intervalMs: PROCESS_CONFIG.healthCheckIntervalMs,
        timeoutMs: PROCESS_CONFIG.healthCheckTimeoutMs,
        retries: 3,
      },
      port: SERVICE_PORTS.algorithmMock,
      dependsOn: [],
      startupTimeout: PROCESS_CONFIG.startupTimeoutMs,
      restartPolicy: 'on-failure',
      maxRestarts: PROCESS_CONFIG.maxRestarts,
    },
  ];
}

export const PROTOCOL_SCHEME = 'lazymind';
export const PROTOCOL_PREFIX = `${PROTOCOL_SCHEME}://`;

export const PROXY_PORT = 5023;
export const PROXY_HOST = '127.0.0.1';

export const SERVICE_PORTS = {
  proxy: 5023,
  authService: 8002,
  core: 8001,
  scanControlPlane: 18080,
  fileWatcher: 18081,
  algorithmMock: 8046,
} as const;

export const DATA_DIR_NAME = 'LazyMind';

export const DEFAULT_ASSISTANT = {
  username: 'astronomer',
  displayName: '天文学家',
  avatar: '🪐',
  description:
    '我是天文学家，一位研究宇宙奥秘的科学家。我对恒星、行星、星系和宇宙的起源有深入的了解。让我们一起探索浩瀚的宇宙吧！',
} as const;

export const LOG_CONFIG = {
  maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
} as const;

export const PROCESS_CONFIG = {
  maxRestarts: 3,
  healthCheckIntervalMs: 3000,
  healthCheckTimeoutMs: 5000,
  startupTimeoutMs: 30000,
  shutdownTimeoutMs: 10000,
} as const;

export const LOCAL_SECRET_LENGTH = 32; // 32 bytes = 64 hex chars

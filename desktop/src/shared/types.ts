export interface DataDirPaths {
  root: string;
  config: string;
  data: string;
  vector: string;
  segment: string;
  uploads: string;
  scanned: string;
  cache: string;
  logs: string;
  diagnostics: string;
  crash: string;
  backups: string;
  defaultDocs: string;
}

export type ProcessState =
  | 'pending'
  | 'starting'
  | 'healthy'
  | 'stopping'
  | 'stopped'
  | 'failed';

export interface ServiceStatus {
  name: string;
  state: ProcessState;
  port: number;
  pid?: number;
  error?: string;
  startedAt?: string;
  healthCheckedAt?: string;
}

export interface ProcessConfig {
  name: string;
  executablePath: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  healthCheck: {
    type: 'http' | 'tcp';
    endpoint?: string;
    intervalMs: number;
    timeoutMs: number;
    retries: number;
  };
  port: number;
  dependsOn: string[];
  startupTimeout: number;
  restartPolicy: 'always' | 'never' | 'on-failure';
  maxRestarts: number;
}

export interface ProcessInfo {
  name: string;
  state: ProcessState;
  port: number;
  pid?: number;
  error?: string;
  startedAt?: string;
  healthCheckedAt?: string;
  restartCount: number;
  memoryUsageMB?: number;
}

export interface AssistantInfo {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  description: string;
  createdAt: string;
}

export interface CreateAssistantData {
  username: string;
  displayName: string;
  avatar: string;
  description: string;
}

export interface ProxyRoute {
  prefix: string;
  target: string;
  stripPrefix: boolean;
  timeout: number;
}

export interface ProxyConfig {
  port: number;
  host: string;
  routes: ProxyRoute[];
  localSecret: string;
  allowedOrigins: string[];
}

export interface DiagnosticsInfo {
  os: string;
  version: string;
  memoryMB: number;
  diskFreeMB: number;
  uptime: number;
  services: ServiceStatus[];
}

export interface LazyMindDesktopAPI {
  getDataDir(): Promise<DataDirPaths>;
  pickFolder(): Promise<string | null>;
  openPath(path: string): Promise<void>;
  exportDiagnostics(): Promise<string>;
  getServiceStatus(name: string): Promise<ServiceStatus | null>;
  getAllServiceStatus(): Promise<ServiceStatus[]>;
  getCurrentAssistant(): Promise<AssistantInfo | null>;
  setCurrentAssistant(id: string): Promise<void>;
  getAssistantList(): Promise<AssistantInfo[]>;
  getVersion(): string;
  isPackaged(): boolean;
  getMode(): 'desktop';
  onServiceStatusChanged(callback: (status: ServiceStatus) => void): () => void;
  setCredential(service: string, account: string, secret: string): Promise<void>;
  getCredential(service: string, account: string): Promise<string | null>;
  deleteCredential(service: string, account: string): Promise<void>;
  listCredentials(service: string): Promise<string[]>;
}

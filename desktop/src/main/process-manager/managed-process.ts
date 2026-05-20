import { ChildProcess, spawn } from 'child_process';
import http from 'http';
import type { ProcessConfig, ProcessState, ProcessInfo } from '../../shared/types';
import { logger, createProcessStream } from '../logger';
import { isPortInUse } from './port-check';

const ENV_WHITELIST = [
  'PATH', 'TEMP', 'TMP', 'SYSTEMROOT', 'APPDATA', 'LOCALAPPDATA',
  'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'COMPUTERNAME',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES',
  'WINDIR', 'SYSTEMDRIVE',
];

export class ManagedProcess {
  private process: ChildProcess | null = null;
  private _state: ProcessState = 'pending';
  private _pid?: number;
  private _error?: string;
  private _startedAt?: string;
  private _healthCheckedAt?: string;
  private _restartCount = 0;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private onStateChangeFn?: (info: ProcessInfo) => void;

  constructor(private config: ProcessConfig) {}

  get state(): ProcessState { return this._state; }
  get info(): ProcessInfo {
    return {
      name: this.config.name,
      state: this._state,
      port: this.config.port,
      pid: this._pid,
      error: this._error,
      startedAt: this._startedAt,
      healthCheckedAt: this._healthCheckedAt,
      restartCount: this._restartCount,
    };
  }

  onStateChange(fn: (info: ProcessInfo) => void): void {
    this.onStateChangeFn = fn;
  }

  async start(): Promise<void> {
    if (this._state === 'healthy' || this._state === 'starting') return;

    const portBusy = await isPortInUse(this.config.port);
    if (portBusy) {
      this.setState('failed');
      this._error = `Port ${this.config.port} already in use`;
      logger.error('process-manager', `${this.config.name}: ${this._error}`);
      return;
    }

    this.setState('starting');
    this._error = undefined;

    const filteredEnv: Record<string, string> = {};
    for (const key of ENV_WHITELIST) {
      if (process.env[key]) {
        filteredEnv[key] = process.env[key]!;
      }
    }
    Object.assign(filteredEnv, this.config.env);

    const { stdout, stderr } = createProcessStream(this.config.name);

    this.process = spawn(this.config.executablePath, this.config.args, {
      env: filteredEnv,
      cwd: this.config.cwd || undefined,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this._pid = this.process.pid;
    this._startedAt = new Date().toISOString();

    this.process.stdout?.pipe(stdout);
    this.process.stderr?.pipe(stderr);

    this.process.on('error', (err) => {
      logger.error('process-manager', `${this.config.name} spawn error: ${err.message}`);
      this._error = err.message;
      this.setState('failed');
      this.handleExit();
    });

    this.process.on('exit', (code, signal) => {
      logger.info('process-manager', `${this.config.name} exited (code=${code}, signal=${signal})`);
      if (this._state !== 'stopping') {
        this._error = `Process exited unexpectedly (code=${code})`;
        this.setState('failed');
        this.handleExit();
      } else {
        this.setState('stopped');
      }
      this.process = null;
      this._pid = undefined;
    });

    this.startHealthCheck();
  }

  async stop(): Promise<void> {
    this.stopHealthCheck();
    if (!this.process || !this._pid) {
      this.setState('stopped');
      return;
    }

    this.setState('stopping');

    // On Windows, use taskkill to kill process tree
    const killProcess = spawn('taskkill', ['/T', '/F', '/PID', String(this._pid)], {
      shell: false,
      windowsHide: true,
    });

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.process?.kill('SIGKILL');
        resolve();
      }, 5000);

      killProcess.on('close', () => {
        clearTimeout(timeout);
        this.setState('stopped');
        this.process = null;
        this._pid = undefined;
        resolve();
      });
    });
  }

  private startHealthCheck(): void {
    const { healthCheck } = this.config;
    let retries = 0;

    this.healthTimer = setInterval(async () => {
      const healthy = await this.checkHealth();
      if (healthy) {
        retries = 0;
        if (this._state !== 'healthy') {
          this.setState('healthy');
          logger.info('process-manager', `${this.config.name} is healthy`);
        }
        this._healthCheckedAt = new Date().toISOString();
      } else if (this._state === 'starting') {
        retries++;
        if (retries >= healthCheck.retries) {
          const elapsed = Date.now() - new Date(this._startedAt || '').getTime();
          if (elapsed > this.config.startupTimeout) {
            this._error = 'Startup timeout';
            this.setState('failed');
            this.stopHealthCheck();
            this.handleExit();
          }
        }
      }
    }, healthCheck.intervalMs);
  }

  private stopHealthCheck(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private async checkHealth(): Promise<boolean> {
    const { healthCheck } = this.config;
    if (healthCheck.type === 'http' && healthCheck.endpoint) {
      return this.httpHealthCheck(healthCheck.endpoint, healthCheck.timeoutMs);
    }
    return false;
  }

  private httpHealthCheck(url: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        resolve(res.statusCode !== undefined && res.statusCode < 500);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  private handleExit(): void {
    this.stopHealthCheck();
    if (
      this.config.restartPolicy === 'always' ||
      (this.config.restartPolicy === 'on-failure' && this._state === 'failed')
    ) {
      if (this._restartCount < this.config.maxRestarts) {
        this._restartCount++;
        const delay = Math.min(1000 * Math.pow(2, this._restartCount - 1), 10000);
        logger.warn(
          'process-manager',
          `${this.config.name} restarting in ${delay}ms (attempt ${this._restartCount}/${this.config.maxRestarts})`
        );
        setTimeout(() => this.start(), delay);
      } else {
        logger.error('process-manager', `${this.config.name} max restarts exceeded`);
      }
    }
  }

  private setState(state: ProcessState): void {
    this._state = state;
    this.onStateChangeFn?.(this.info);
  }
}

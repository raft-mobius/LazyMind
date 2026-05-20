import type { ProcessConfig, ProcessState, ProcessInfo } from '../../shared/types';

export type { ProcessConfig, ProcessState, ProcessInfo };

export interface ProcessManager {
  start(name: string): Promise<void>;
  stop(name: string): Promise<void>;
  restart(name: string): Promise<void>;
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
  getInfo(name: string): ProcessInfo | null;
  getAllInfo(): ProcessInfo[];
  onStateChange(callback: (info: ProcessInfo) => void): () => void;
}

export type StateChangeCallback = (info: ProcessInfo) => void;

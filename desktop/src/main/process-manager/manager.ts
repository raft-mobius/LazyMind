import type { ProcessConfig, ProcessInfo } from '../../shared/types';
import type { ProcessManager, StateChangeCallback } from './types';
import { ManagedProcess } from './managed-process';
import { PROCESS_CONFIG } from '../../shared/constants';
import { logger } from '../logger';

export function createProcessManager(configs: ProcessConfig[]): ProcessManager {
  const processes = new Map<string, ManagedProcess>();
  const listeners = new Set<StateChangeCallback>();

  for (const config of configs) {
    const proc = new ManagedProcess(config);
    proc.onStateChange((info) => {
      for (const listener of listeners) {
        listener(info);
      }
    });
    processes.set(config.name, proc);
  }

  function topologicalSort(configs: ProcessConfig[]): ProcessConfig[][] {
    const layers: ProcessConfig[][] = [];
    const resolved = new Set<string>();
    const remaining = [...configs];

    while (remaining.length > 0) {
      const layer = remaining.filter((c) =>
        c.dependsOn.every((dep) => resolved.has(dep))
      );
      if (layer.length === 0) {
        logger.error('process-manager', 'Circular dependency detected');
        layers.push(remaining);
        break;
      }
      layers.push(layer);
      for (const c of layer) {
        resolved.add(c.name);
      }
      remaining.splice(0, remaining.length, ...remaining.filter((c) => !resolved.has(c.name)));
    }
    return layers;
  }

  const manager: ProcessManager = {
    async start(name: string) {
      const proc = processes.get(name);
      if (!proc) throw new Error(`Unknown process: ${name}`);
      await proc.start();
    },

    async stop(name: string) {
      const proc = processes.get(name);
      if (!proc) throw new Error(`Unknown process: ${name}`);
      await proc.stop();
    },

    async restart(name: string) {
      await manager.stop(name);
      await manager.start(name);
    },

    async startAll() {
      const layers = topologicalSort(configs);
      for (const layer of layers) {
        await Promise.all(
          layer.map((config) => {
            const proc = processes.get(config.name);
            return proc?.start();
          })
        );
        // Wait for this layer to become healthy before starting next layer
        await waitForLayerHealthy(layer, processes);
      }
    },

    async stopAll() {
      const shutdownTimeout = PROCESS_CONFIG.shutdownTimeoutMs;
      const stopPromise = Promise.all(
        Array.from(processes.values()).map((proc) => proc.stop())
      );
      await Promise.race([
        stopPromise,
        new Promise((resolve) => setTimeout(resolve, shutdownTimeout)),
      ]);
    },

    getInfo(name: string) {
      return processes.get(name)?.info || null;
    },

    getAllInfo() {
      return Array.from(processes.values()).map((p) => p.info);
    },

    onStateChange(callback: StateChangeCallback) {
      listeners.add(callback);
      return () => { listeners.delete(callback); };
    },
  };

  return manager;
}

async function waitForLayerHealthy(
  layer: ProcessConfig[],
  processes: Map<string, ManagedProcess>
): Promise<void> {
  const maxWait = PROCESS_CONFIG.startupTimeoutMs;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const allHealthy = layer.every((config) => {
      const proc = processes.get(config.name);
      return proc?.state === 'healthy';
    });
    const anyFailed = layer.some((config) => {
      const proc = processes.get(config.name);
      return proc?.state === 'failed';
    });

    if (allHealthy) return;
    if (anyFailed) return; // Don't block; let failed services handle their own retry
    await new Promise((r) => setTimeout(r, 1000));
  }
}

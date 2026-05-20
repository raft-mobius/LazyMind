import fs from 'fs';
import path from 'path';
import http from 'http';
import type { AssistantInfo } from '../shared/types';
import { getDataDir } from './data-dir';
import { SERVICE_PORTS } from '../shared/constants';
import { logger } from './logger';
import type { ProxyServer } from './proxy';

interface AssistantState {
  currentId: string;
  lastUpdated: string;
}

export interface AssistantManager {
  initialize(): Promise<void>;
  getCurrent(): AssistantInfo | null;
  setCurrent(id: string): Promise<void>;
  getList(): Promise<AssistantInfo[]>;
}

export function createAssistantManager(proxy: ProxyServer): AssistantManager {
  let currentAssistant: AssistantInfo | null = null;
  let assistantList: AssistantInfo[] = [];

  function getStatePath(): string {
    const dirs = getDataDir();
    return path.join(dirs.root, 'assistant-state.json');
  }

  function loadPersistedState(): AssistantState | null {
    const statePath = getStatePath();
    if (!fs.existsSync(statePath)) return null;
    try {
      const raw = fs.readFileSync(statePath, 'utf-8');
      return JSON.parse(raw) as AssistantState;
    } catch {
      return null;
    }
  }

  function persistState(assistantId: string): void {
    const statePath = getStatePath();
    const state: AssistantState = {
      currentId: assistantId,
      lastUpdated: new Date().toISOString(),
    };
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  }

  async function callAuthService<T>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: '127.0.0.1',
        port: SERVICE_PORTS.authService,
        path,
        method,
        headers: { 'Content-Type': 'application/json' },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data ? JSON.parse(data) : ({} as T));
          } else {
            reject(new Error(`Auth service ${method} ${path} returned ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  const manager: AssistantManager = {
    async initialize() {
      try {
        // Bootstrap (idempotent)
        await callAuthService('POST', '/api/authservice/desktop/bootstrap');
        logger.info('assistant-manager', 'Bootstrap completed');

        // Get identity
        const identity = await callAuthService<{ user_id: string; username: string; display_name: string }>(
          'GET',
          '/api/authservice/desktop/identity'
        );

        // Get assistant list
        assistantList = await callAuthService<AssistantInfo[]>(
          'GET',
          '/api/authservice/desktop/assistants'
        );

        // Restore persisted state or use default
        const savedState = loadPersistedState();
        const targetId = savedState?.currentId || identity.user_id;

        const found = assistantList.find((a) => a.id === targetId);
        if (found) {
          currentAssistant = found;
        } else if (assistantList.length > 0) {
          currentAssistant = assistantList[0];
        }

        if (currentAssistant) {
          proxy.setCurrentIdentity(currentAssistant.id, currentAssistant.displayName);
          persistState(currentAssistant.id);
        }

        logger.info('assistant-manager', `Current assistant: ${currentAssistant?.displayName || 'none'}`);
      } catch (err) {
        logger.error('assistant-manager', `Initialize failed: ${err}`);
      }
    },

    getCurrent() {
      return currentAssistant;
    },

    async setCurrent(id: string) {
      const found = assistantList.find((a) => a.id === id);
      if (!found) {
        // Refresh list and try again
        assistantList = await callAuthService<AssistantInfo[]>(
          'GET',
          '/api/authservice/desktop/assistants'
        );
        const retryFound = assistantList.find((a) => a.id === id);
        if (!retryFound) throw new Error(`Assistant not found: ${id}`);
        currentAssistant = retryFound;
      } else {
        currentAssistant = found;
      }

      proxy.setCurrentIdentity(currentAssistant!.id, currentAssistant!.displayName);
      persistState(currentAssistant!.id);
      logger.info('assistant-manager', `Switched to: ${currentAssistant!.displayName}`);
    },

    async getList() {
      assistantList = await callAuthService<AssistantInfo[]>(
        'GET',
        '/api/authservice/desktop/assistants'
      );
      return assistantList;
    },
  };

  return manager;
}

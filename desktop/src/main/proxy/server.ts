import http from 'http';
import httpProxy from 'http-proxy';
import crypto from 'crypto';
import type { ProxyRoute, ProxyConfig } from '../../shared/types';
import { matchRoute } from './routes';
import { SECURITY_CONFIG } from '../security/config';
import { logger } from '../logger';

export interface ProxyServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  getPort(): number;
  setCurrentIdentity(userId: string, userName: string): void;
  isRunning(): boolean;
}

export function createProxyServer(config: ProxyConfig): ProxyServer {
  let server: http.Server | null = null;
  let proxy: httpProxy | null = null;
  let currentUserId = '';
  let currentUserName = '';

  function isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return true; // No origin = same-origin or non-browser
    return SECURITY_CONFIG.allowedOrigins.some(
      (allowed) => origin === allowed || origin.startsWith(allowed)
    );
  }

  function setCorsHeaders(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): boolean {
    const origin = req.headers['origin'] as string | undefined;

    if (origin && !isAllowedOrigin(origin)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('CORS: origin not allowed');
      return false;
    }

    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Max-Age', '86400');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return false;
    }

    return true;
  }

  const proxyServer: ProxyServer = {
    async start() {
      proxy = httpProxy.createProxyServer({
        xfwd: false,
        changeOrigin: true,
      });

      proxy.on('error', (err, _req, res) => {
        logger.error('proxy', `Proxy error: ${err.message}`);
        if (res instanceof http.ServerResponse && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Backend unavailable' }));
        }
      });

      server = http.createServer((req, res) => {
        if (!setCorsHeaders(req, res)) return;

        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const route = matchRoute(url.pathname, config.routes);

        if (!route) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No matching route' }));
          return;
        }

        // Strip prefix if configured
        if (route.stripPrefix) {
          req.url = req.url!.replace(route.prefix, '') || '/';
        }

        // Remove frontend-sent auth headers (proxy is the authority)
        delete req.headers['authorization'];
        delete req.headers['x-user-id'];
        delete req.headers['x-user-name'];

        // Inject identity headers
        req.headers['x-user-id'] = currentUserId;
        req.headers['x-user-name'] = encodeURIComponent(currentUserName);
        req.headers['x-desktop-secret'] = config.localSecret;
        req.headers['x-request-id'] = crypto.randomUUID();

        const target = route.target;

        proxy!.web(req, res, {
          target,
          timeout: route.timeout,
          proxyTimeout: route.timeout,
        });
      });

      return new Promise((resolve, reject) => {
        server!.listen(config.port, config.host, () => {
          logger.info('proxy', `Local proxy listening on ${config.host}:${config.port}`);
          resolve();
        });
        server!.on('error', reject);
      });
    },

    async stop() {
      if (proxy) {
        proxy.close();
        proxy = null;
      }
      if (server) {
        return new Promise<void>((resolve) => {
          server!.close(() => resolve());
          // Force close after 3s
          setTimeout(() => resolve(), 3000);
        });
      }
    },

    getPort() {
      return config.port;
    },

    setCurrentIdentity(userId: string, userName: string) {
      currentUserId = userId;
      currentUserName = userName;
    },

    isRunning() {
      return server?.listening || false;
    },
  };

  return proxyServer;
}

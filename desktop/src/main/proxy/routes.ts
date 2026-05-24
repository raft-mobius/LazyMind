import type { ProxyRoute } from '../../shared/types';
import { SERVICE_PORTS } from '../../shared/constants';

export function getDefaultRoutes(): ProxyRoute[] {
  return [
    {
      prefix: '/api/authservice',
      target: `http://127.0.0.1:${SERVICE_PORTS.authService}`,
      stripPrefix: false,
      timeout: 30000,
    },
    {
      prefix: '/api/core',
      target: `http://127.0.0.1:${SERVICE_PORTS.core}`,
      stripPrefix: true,
      timeout: 600000,
    },
    {
      prefix: '/api/chat',
      target: `http://127.0.0.1:${SERVICE_PORTS.algorithmService}`,
      stripPrefix: false,
      timeout: 600000,
    },
    {
      prefix: '/api/scan',
      target: `http://127.0.0.1:${SERVICE_PORTS.scanControlPlane}`,
      stripPrefix: false,
      timeout: 30000,
    },
    {
      prefix: '/api/file',
      target: `http://127.0.0.1:${SERVICE_PORTS.fileWatcher}`,
      stripPrefix: false,
      timeout: 30000,
    },
    {
      prefix: '/internal/credentials',
      target: '', // Handled by credential bridge, not proxied
      stripPrefix: false,
      timeout: 5000,
    },
  ];
}

export function matchRoute(pathname: string, routes: ProxyRoute[]): ProxyRoute | null {
  // Match longest prefix first
  const sorted = [...routes].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const route of sorted) {
    if (pathname.startsWith(route.prefix)) {
      return route;
    }
  }
  return null;
}

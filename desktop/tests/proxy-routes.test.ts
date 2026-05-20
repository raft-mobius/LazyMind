import { describe, it, expect } from 'vitest';
import { matchRoute, getDefaultRoutes } from '../src/main/proxy/routes';

describe('proxy routes', () => {
  const routes = getDefaultRoutes();

  it('matches /api/authservice path', () => {
    const route = matchRoute('/api/authservice/auth/login', routes);
    expect(route).not.toBeNull();
    expect(route!.prefix).toBe('/api/authservice');
    expect(route!.stripPrefix).toBe(false);
  });

  it('matches /api/core path with strip', () => {
    const route = matchRoute('/api/core/conversations', routes);
    expect(route).not.toBeNull();
    expect(route!.prefix).toBe('/api/core');
    expect(route!.stripPrefix).toBe(true);
  });

  it('matches /api/chat path', () => {
    const route = matchRoute('/api/chat/stream', routes);
    expect(route).not.toBeNull();
    expect(route!.prefix).toBe('/api/chat');
  });

  it('matches /api/scan path', () => {
    const route = matchRoute('/api/scan/sources', routes);
    expect(route).not.toBeNull();
    expect(route!.prefix).toBe('/api/scan');
  });

  it('matches /api/file path', () => {
    const route = matchRoute('/api/file/status', routes);
    expect(route).not.toBeNull();
    expect(route!.prefix).toBe('/api/file');
  });

  it('returns null for unknown paths', () => {
    const route = matchRoute('/unknown/path', routes);
    expect(route).toBeNull();
  });

  it('matches longer prefix first (longest match)', () => {
    const customRoutes = [
      { prefix: '/api', target: 'http://localhost:8000', stripPrefix: false, timeout: 30000 },
      { prefix: '/api/core', target: 'http://localhost:8001', stripPrefix: true, timeout: 30000 },
    ];
    const route = matchRoute('/api/core/health', customRoutes);
    expect(route!.target).toBe('http://localhost:8001');
  });
});

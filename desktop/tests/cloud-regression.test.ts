import { describe, it, expect } from 'vitest';
import { SECURITY_CONFIG } from '../src/main/security/config';
import { SERVICE_PORTS } from '../src/shared/constants';

describe('Cloud Mode Regression', () => {
  it('security config maintains backward compatibility', () => {
    // Original channels still present
    const channels = SECURITY_CONFIG.allowedChannels;
    expect(channels).toContain('dialog:pickFolder');
    expect(channels).toContain('service:getStatus');
    expect(channels).toContain('assistant:getCurrent');
    // New credential channels added without removing any
    expect(channels).toContain('credential:set');
    expect(channels).toContain('credential:get');
    expect(channels.length).toBeGreaterThanOrEqual(15);
  });

  it('SERVICE_PORTS maintains backward compatibility', () => {
    expect(SERVICE_PORTS.core).toBe(8001);
    expect(SERVICE_PORTS.authService).toBe(8002);
    expect(SERVICE_PORTS.scanControlPlane).toBe(18080);
    expect(SERVICE_PORTS.fileWatcher).toBe(18081);
    // algorithmMock still accessible for backward compat
    expect(SERVICE_PORTS.algorithmMock).toBe(8046);
    // New algorithmService on same port
    expect(SERVICE_PORTS.algorithmService).toBe(8046);
  });

  it('CSP allows required origins', () => {
    expect(SECURITY_CONFIG.csp).toContain("connect-src lazymind: http://127.0.0.1:* https:");
    expect(SECURITY_CONFIG.csp).toContain("default-src 'self' lazymind:");
  });

  it('allowedOrigins includes dev server', () => {
    expect(SECURITY_CONFIG.allowedOrigins).toContain('lazymind://app');
    expect(SECURITY_CONFIG.allowedOrigins).toContain('http://localhost:5173');
  });
});

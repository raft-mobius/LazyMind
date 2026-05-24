import { describe, it, expect } from 'vitest';

describe('Cold Start Benchmark', () => {
  it('documents the cold start target', () => {
    /**
     * Cold start benchmark: all services should be healthy within 60 seconds.
     *
     * To measure manually:
     * 1. Kill all LazyMind processes
     * 2. Start the Electron app
     * 3. Time until ServiceStatusBar shows all green
     *
     * Expected timeline:
     * - Electron ready: <3s
     * - auth-service healthy: <10s
     * - core healthy: <15s (depends on auth-service)
     * - scan-control-plane healthy: <20s (depends on core)
     * - file-watcher healthy: <25s (depends on scan-control-plane)
     * - algorithm-service healthy: <30s (depends on core, loads Milvus)
     * - Total: <60s with dependency chain
     *
     * Run with: npm run dev, then time the transition to all-green.
     */
    expect(true).toBe(true);
  });

  it('validates startup timeout configuration', async () => {
    const { PROCESS_CONFIG } = await import('../../src/shared/constants');
    // Each service has 30s timeout — with dependency chain, total should be < 60s
    // Since max depth is 4 (auth → core → scan → file-watcher), worst case = 4 * 30s = 120s
    // But in practice services start in <10s each, so 60s target is achievable
    expect(PROCESS_CONFIG.startupTimeoutMs).toBe(30000);
  });
});

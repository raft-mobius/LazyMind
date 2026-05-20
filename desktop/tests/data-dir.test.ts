import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

const TEST_DIR = path.join(os.tmpdir(), 'lazymind-test-datadir-' + Date.now());

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'appData') return os.tmpdir();
      return os.tmpdir();
    },
    isPackaged: false,
  },
}));

describe('data-dir', () => {
  beforeEach(() => {
    process.env.LAZYMIND_DATA_DIR = TEST_DIR;
  });

  afterEach(() => {
    delete process.env.LAZYMIND_DATA_DIR;
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('getDataDir returns correct structure with all expected keys', async () => {
    const { getDataDir } = await import('../src/main/data-dir');
    const dirs = getDataDir();

    expect(dirs).toHaveProperty('root');
    expect(dirs).toHaveProperty('config');
    expect(dirs).toHaveProperty('data');
    expect(dirs).toHaveProperty('vector');
    expect(dirs).toHaveProperty('segment');
    expect(dirs).toHaveProperty('uploads');
    expect(dirs).toHaveProperty('scanned');
    expect(dirs).toHaveProperty('cache');
    expect(dirs).toHaveProperty('logs');
    expect(dirs).toHaveProperty('diagnostics');
    expect(dirs).toHaveProperty('crash');
    expect(dirs).toHaveProperty('backups');
    expect(dirs).toHaveProperty('defaultDocs');
  });

  it('getDataDir root matches LAZYMIND_DATA_DIR env var', async () => {
    const { getDataDir } = await import('../src/main/data-dir');
    const dirs = getDataDir();
    expect(dirs.root).toBe(TEST_DIR);
  });

  it('ensureDataDir creates all directories', async () => {
    const { ensureDataDir, getDataDir } = await import('../src/main/data-dir');
    await ensureDataDir();
    const dirs = getDataDir();

    expect(fs.existsSync(dirs.root)).toBe(true);
    expect(fs.existsSync(dirs.data)).toBe(true);
    expect(fs.existsSync(dirs.logs)).toBe(true);
    expect(fs.existsSync(dirs.vector)).toBe(true);
    expect(fs.existsSync(dirs.cache)).toBe(true);
    expect(fs.existsSync(dirs.backups)).toBe(true);
  });

  it('ensureDataDir is idempotent', async () => {
    const { ensureDataDir } = await import('../src/main/data-dir');
    await ensureDataDir();
    await ensureDataDir(); // second call should not throw
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EncryptedFileBackend } from '../src/main/credentials/file-backend';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('EncryptedFileBackend', () => {
  let backend: EncryptedFileBackend;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lazymind-cred-test-'));
    backend = new EncryptedFileBackend(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should set and get a credential', async () => {
    await backend.set('model', 'dashscope_test', 'sk-12345');
    const result = await backend.get('model', 'dashscope_test');
    expect(result).toBe('sk-12345');
  });

  it('should return null for non-existent credential', async () => {
    const result = await backend.get('model', 'nonexistent');
    expect(result).toBeNull();
  });

  it('should delete a credential', async () => {
    await backend.set('model', 'to_delete', 'secret');
    await backend.delete('model', 'to_delete');
    const result = await backend.get('model', 'to_delete');
    expect(result).toBeNull();
  });

  it('should list accounts under a service', async () => {
    await backend.set('model', 'provider_a', 'key_a');
    await backend.set('model', 'provider_b', 'key_b');
    const accounts = await backend.list('model');
    expect(accounts).toContain('provider_a');
    expect(accounts).toContain('provider_b');
  });

  it('should persist across instances', async () => {
    await backend.set('system', 'local_secret', 'hex_secret_value');

    const backend2 = new EncryptedFileBackend(tempDir);
    const result = await backend2.get('system', 'local_secret');
    expect(result).toBe('hex_secret_value');
  });

  it('should encrypt data on disk', async () => {
    await backend.set('model', 'test_key', 'sensitive_api_key');

    const files = fs.readdirSync(tempDir);
    const credFile = files.find(f => f.endsWith('.enc'));
    expect(credFile).toBeDefined();

    const content = fs.readFileSync(path.join(tempDir, credFile!), 'utf8');
    expect(content).not.toContain('sensitive_api_key');
  });

  it('should isolate services', async () => {
    await backend.set('model', 'key1', 'model_secret');
    await backend.set('system', 'key1', 'system_secret');

    expect(await backend.get('model', 'key1')).toBe('model_secret');
    expect(await backend.get('system', 'key1')).toBe('system_secret');
  });

  it('should report availability', async () => {
    const available = await backend.isAvailable();
    expect(available).toBe(true);
  });
});

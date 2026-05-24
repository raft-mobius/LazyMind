import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CredentialService } from './service';

interface CredentialStore {
  [service: string]: { [account: string]: string };
}

export class EncryptedFileBackend implements CredentialService {
  private filePath: string;
  private encryptionKey: Buffer;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'credentials.enc');
    this.encryptionKey = this.deriveKey();
  }

  private deriveKey(): Buffer {
    const entropy = `${process.env.COMPUTERNAME || 'local'}:${process.env.USERNAME || 'user'}:LazyMind`;
    return crypto.createHash('sha256').update(entropy).digest();
  }

  private encrypt(data: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  private decrypt(encoded: string): string {
    const buf = Buffer.from(encoded, 'base64');
    const iv = buf.subarray(0, 16);
    const tag = buf.subarray(16, 32);
    const data = buf.subarray(32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data, undefined, 'utf8') + decipher.final('utf8');
  }

  private async readStore(): Promise<CredentialStore> {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(this.decrypt(content));
    } catch {
      return {};
    }
  }

  private async writeStore(store: CredentialStore): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.filePath, this.encrypt(JSON.stringify(store)));
  }

  async set(service: string, account: string, secret: string): Promise<void> {
    const store = await this.readStore();
    if (!store[service]) store[service] = {};
    store[service][account] = secret;
    await this.writeStore(store);
  }

  async get(service: string, account: string): Promise<string | null> {
    const store = await this.readStore();
    return store[service]?.[account] ?? null;
  }

  async delete(service: string, account: string): Promise<void> {
    const store = await this.readStore();
    if (store[service]) {
      delete store[service][account];
      if (Object.keys(store[service]).length === 0) {
        delete store[service];
      }
      await this.writeStore(store);
    }
  }

  async list(service: string): Promise<string[]> {
    const store = await this.readStore();
    return Object.keys(store[service] ?? {});
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.set('_probe', '_test', 'probe');
      await this.delete('_probe', '_test');
      return true;
    } catch {
      return false;
    }
  }
}

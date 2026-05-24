import type { CredentialService } from './service';

const SERVICE_PREFIX = 'LazyMind';

export class KeytarBackend implements CredentialService {
  private keytar: typeof import('keytar') | null = null;

  private async getKeytar() {
    if (!this.keytar) {
      this.keytar = await import('keytar');
    }
    return this.keytar;
  }

  private fullService(service: string): string {
    return `${SERVICE_PREFIX}.${service}`;
  }

  async set(service: string, account: string, secret: string): Promise<void> {
    const kt = await this.getKeytar();
    await kt.setPassword(this.fullService(service), account, secret);
  }

  async get(service: string, account: string): Promise<string | null> {
    const kt = await this.getKeytar();
    return kt.getPassword(this.fullService(service), account);
  }

  async delete(service: string, account: string): Promise<void> {
    const kt = await this.getKeytar();
    await kt.deletePassword(this.fullService(service), account);
  }

  async list(service: string): Promise<string[]> {
    const kt = await this.getKeytar();
    const creds = await kt.findCredentials(this.fullService(service));
    return creds.map(c => c.account);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const kt = await this.getKeytar();
      await kt.setPassword(`${SERVICE_PREFIX}._probe`, '_test', 'probe');
      await kt.deletePassword(`${SERVICE_PREFIX}._probe`, '_test');
      return true;
    } catch {
      return false;
    }
  }
}

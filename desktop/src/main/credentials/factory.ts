import type { CredentialService } from './service';
import { KeytarBackend } from './backend';
import { EncryptedFileBackend } from './file-backend';

export async function createCredentialService(dataDir: string): Promise<CredentialService> {
  const keytar = new KeytarBackend();
  if (await keytar.isAvailable()) {
    return keytar;
  }
  console.warn('[credentials] Windows Credential Manager unavailable, using encrypted file fallback');
  return new EncryptedFileBackend(dataDir);
}

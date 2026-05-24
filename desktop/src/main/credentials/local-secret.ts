import crypto from 'node:crypto';
import type { CredentialService } from './service';

export async function ensureLocalSecret(credService: CredentialService): Promise<string> {
  let secret = await credService.get('system', 'local_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    await credService.set('system', 'local_secret', secret);
  }
  return secret;
}

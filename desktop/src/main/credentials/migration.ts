import fs from 'node:fs/promises';
import type { CredentialService } from './service';

export async function migrateFromPlaintext(
  configPath: string,
  credService: CredentialService
): Promise<number> {
  let config: any;
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    config = JSON.parse(raw);
  } catch {
    return 0;
  }

  let migrated = 0;

  if (config.models && Array.isArray(config.models)) {
    for (const model of config.models) {
      if (model.api_key && model.api_key !== '__SECURE_STORE__') {
        await credService.set('model', `${model.provider}_${model.id}`, model.api_key);
        model.api_key = '__SECURE_STORE__';
        migrated++;
      }
    }
  }

  if (migrated > 0) {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  }
  return migrated;
}

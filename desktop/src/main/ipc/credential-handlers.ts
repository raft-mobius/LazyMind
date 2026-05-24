import { ipcMain } from 'electron';
import type { CredentialService } from '../credentials/service';

function validateServiceName(name: string): void {
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(name)) {
    throw new Error('Invalid service name');
  }
}

function validateAccountName(name: string): void {
  if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(name)) {
    throw new Error('Invalid account name');
  }
}

export function registerCredentialHandlers(credService: CredentialService): void {
  ipcMain.handle('credential:set', async (_event, service: string, account: string, secret: string) => {
    validateServiceName(service);
    validateAccountName(account);
    await credService.set(service, account, secret);
  });

  ipcMain.handle('credential:get', async (_event, service: string, account: string) => {
    validateServiceName(service);
    validateAccountName(account);
    return credService.get(service, account);
  });

  ipcMain.handle('credential:delete', async (_event, service: string, account: string) => {
    validateServiceName(service);
    validateAccountName(account);
    await credService.delete(service, account);
  });

  ipcMain.handle('credential:list', async (_event, service: string) => {
    validateServiceName(service);
    return credService.list(service);
  });
}

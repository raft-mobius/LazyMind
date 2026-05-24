# LLD-07: Credential & Secret Management

## 1. Module Overview

### 1.1 Goal

Replace plaintext storage of sensitive credentials (model API keys, local secret) with OS-native secure storage. On Windows, use DPAPI (Data Protection API) via the `keytar` Electron library to store secrets in Windows Credential Manager. Ensure secrets are encrypted at rest and accessible only to the current Windows user.

### 1.2 Scope

**Included:**
- Store model API keys in Windows Credential Manager (via DPAPI).
- Store/retrieve local desktop secret securely.
- Migration path: detect plaintext secrets in config → move to secure store.
- Electron main-process credential service (IPC-exposed).
- Backend retrieval: core reads secrets via secure file or IPC-injected env.
- Fallback: if credential store unavailable, degrade to encrypted file with user warning.

**Not Included:**
- OAuth token flow (no external OAuth in Desktop Mode).
- Secrets rotation policy (manual user management).
- Hardware security module (HSM) integration.
- Linux/macOS keychain (Windows-only for this phase).

---

## 2. Interface Contracts

### 2.1 Credential Service (Electron Main Process)

```typescript
// desktop/src/main/credentials/service.ts
export interface CredentialService {
  /** Store a secret under service/account key. */
  set(service: string, account: string, secret: string): Promise<void>;

  /** Retrieve a secret. Returns null if not found. */
  get(service: string, account: string): Promise<string | null>;

  /** Delete a secret. */
  delete(service: string, account: string): Promise<void>;

  /** List all accounts under a service. */
  list(service: string): Promise<string[]>;

  /** Check if secure storage is available. */
  isAvailable(): Promise<boolean>;
}
```

### 2.2 IPC Channels (addition to whitelist)

```typescript
// New channels added to security config
'credential:set'     // (service, account, secret) → void
'credential:get'     // (service, account) → string | null
'credential:delete'  // (service, account) → void
'credential:list'    // (service) → string[]
```

### 2.3 Credential Namespaces

| Service Name | Account Pattern | Stores |
|---|---|---|
| `lazymind.model` | `{provider}_{config_id}` | Model API key |
| `lazymind.system` | `local_secret` | Desktop local secret |
| `lazymind.system` | `db_encryption_key` | (future) DB encryption key |

### 2.4 Backend Secret Injection

```typescript
// Process Manager injects secrets as env vars at process start
// Secrets are read from credential store, never written to disk
interface SecretInjection {
  LOCAL_SECRET: string;       // Always injected to all services
  // Model API keys: NOT injected as env vars
  // Instead, core reads them on-demand via a local file socket or API
}
```

---

## 3. Dependencies

**Requires:**
- Phase 1: Process Manager (for env injection).
- Phase 1: IPC security framework (secureHandle).
- Phase 1: Local secret generation.

**Depended on by:**
- LLD-04 Algorithm Pipeline (model API keys for embedding/LLM calls).
- LLD-06 Frontend (model config page stores keys via IPC).

---

## 4. Technical Design

### 4.1 Storage Backend Selection

```typescript
// desktop/src/main/credentials/backend.ts
import keytar from 'keytar';

export class KeytarBackend implements CredentialService {
  private static SERVICE_PREFIX = 'LazyMind';

  async set(service: string, account: string, secret: string): Promise<void> {
    await keytar.setPassword(
      `${KeytarBackend.SERVICE_PREFIX}.${service}`,
      account,
      secret
    );
  }

  async get(service: string, account: string): Promise<string | null> {
    return keytar.getPassword(
      `${KeytarBackend.SERVICE_PREFIX}.${service}`,
      account
    );
  }

  async delete(service: string, account: string): Promise<void> {
    await keytar.deletePassword(
      `${KeytarBackend.SERVICE_PREFIX}.${service}`,
      account
    );
  }

  async list(service: string): Promise<string[]> {
    const creds = await keytar.findCredentials(
      `${KeytarBackend.SERVICE_PREFIX}.${service}`
    );
    return creds.map(c => c.account);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await keytar.setPassword('LazyMind._probe', '_test', 'probe');
      await keytar.deletePassword('LazyMind._probe', '_test');
      return true;
    } catch {
      return false;
    }
  }
}
```

### 4.2 Fallback: Encrypted File Store

When Windows Credential Manager is unavailable (e.g., headless environment, restricted policies):

```typescript
// desktop/src/main/credentials/file-backend.ts
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export class EncryptedFileBackend implements CredentialService {
  private filePath: string;
  private encryptionKey: Buffer;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'credentials.enc');
    // Derive key from machine-specific entropy (DPAPI fallback)
    this.encryptionKey = this.deriveKey();
  }

  private deriveKey(): Buffer {
    // Use machine SID + username as entropy source
    const entropy = `${process.env.COMPUTERNAME}:${process.env.USERNAME}:LazyMind`;
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
    return decipher.update(data) + decipher.final('utf8');
  }

  // ... CRUD operations read/write encrypted JSON file
}
```

### 4.3 Factory

```typescript
// desktop/src/main/credentials/factory.ts
export async function createCredentialService(dataDir: string): Promise<CredentialService> {
  const keytar = new KeytarBackend();
  if (await keytar.isAvailable()) {
    return keytar;
  }
  log.warn('Windows Credential Manager unavailable, using encrypted file fallback');
  return new EncryptedFileBackend(dataDir);
}
```

### 4.4 IPC Integration

```typescript
// desktop/src/main/ipc/credential-handlers.ts
export function registerCredentialHandlers(credService: CredentialService) {
  secureHandle('credential:set', async (_event, service: string, account: string, secret: string) => {
    validateServiceName(service);
    validateAccountName(account);
    await credService.set(service, account, secret);
  });

  secureHandle('credential:get', async (_event, service: string, account: string) => {
    validateServiceName(service);
    validateAccountName(account);
    return credService.get(service, account);
  });

  secureHandle('credential:delete', async (_event, service: string, account: string) => {
    validateServiceName(service);
    validateAccountName(account);
    await credService.delete(service, account);
  });

  secureHandle('credential:list', async (_event, service: string) => {
    validateServiceName(service);
    return credService.list(service);
  });
}

function validateServiceName(name: string) {
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(name)) {
    throw new Error('Invalid service name');
  }
}

function validateAccountName(name: string) {
  if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(name)) {
    throw new Error('Invalid account name');
  }
}
```

### 4.5 Local Secret Lifecycle

Phase 1 generates `LOCAL_SECRET` and stores it in memory. Phase 2 persists it:

```typescript
// desktop/src/main/credentials/local-secret.ts
export async function ensureLocalSecret(credService: CredentialService): Promise<string> {
  let secret = await credService.get('system', 'local_secret');
  if (!secret) {
    // First run or credential store cleared
    secret = crypto.randomBytes(32).toString('hex');
    await credService.set('system', 'local_secret', secret);
  }
  return secret;
}
```

### 4.6 Model API Key Storage Flow

```
Frontend "Save API Key" button
    │
    ▼
IPC: credential:set('model', 'dashscope_uuid123', 'sk-xxxxx')
    │
    ▼
KeytarBackend → Windows Credential Manager
    │
    ▼
Core API: POST /api/core/model-configs
    body: { provider: 'dashscope', model_name: 'qwen-plus', config_id: 'uuid123' }
    (API key NOT sent to backend — only config_id reference)
    │
    ▼
When algorithm-service needs API key:
    GET /api/core/model-configs/{id}/key  (internal, secret-protected)
    → core reads from credential store via Electron IPC bridge
    → Returns decrypted key in response (localhost only, secret-validated)
```

### 4.7 Credential Bridge for Backend Services

Backend services need model API keys but don't have direct access to Windows Credential Manager. Solution: credential bridge endpoint.

```typescript
// desktop/src/main/proxy/credential-bridge.ts
// Adds a route to local proxy that backend services can call:
// GET /internal/credentials/{service}/{account}
// Requires X-Desktop-Secret header
// Returns: { "value": "sk-xxxxx" }
```

This route is:
- Only accessible via 127.0.0.1 (local proxy binding).
- Requires X-Desktop-Secret for authentication.
- Not exposed to frontend (frontend uses IPC).
- Only responds to backend service requests.

### 4.8 Migration from Plaintext

On first Phase 2 boot:
1. Check if `config.json` contains plaintext API keys.
2. If yes: migrate each key to credential store.
3. Replace plaintext values with `"__SECURE_STORE__"` sentinel.
4. Log migration success count.

```typescript
// desktop/src/main/credentials/migration.ts
export async function migrateFromPlaintext(
  configPath: string,
  credService: CredentialService
): Promise<number> {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  let migrated = 0;

  if (config.models) {
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
```

---

## 5. File Manifest

### New Files
- `desktop/src/main/credentials/service.ts` — Interface definition
- `desktop/src/main/credentials/backend.ts` — Keytar (Windows Credential Manager) implementation
- `desktop/src/main/credentials/file-backend.ts` — Encrypted file fallback
- `desktop/src/main/credentials/factory.ts` — Backend selection
- `desktop/src/main/credentials/local-secret.ts` — Local secret persistence
- `desktop/src/main/credentials/migration.ts` — Plaintext migration
- `desktop/src/main/ipc/credential-handlers.ts` — IPC channel handlers
- `desktop/src/main/proxy/credential-bridge.ts` — Backend credential access route
- `desktop/src/preload/credential-api.ts` — Preload API for credential ops

### Modified Files
- `desktop/src/main/security/config.ts` — Add credential IPC channels to whitelist
- `desktop/src/main/index.ts` — Initialize credential service
- `desktop/src/main/process-manager/manager.ts` — Inject secrets from credential store
- `desktop/src/main/proxy/routes.ts` — Add internal credential bridge route
- `desktop/src/preload/index.ts` — Expose credential API
- `desktop/package.json` — Add `keytar` dependency

---

## 6. Configuration & Environment Variables

| Variable | Context | Purpose |
|----------|---------|---------|
| `LAZYMIND_CREDENTIAL_BACKEND` | Electron main | `keytar` (default) / `file` (fallback) |

No backend service env changes — secrets injected at runtime.

---

## 7. Error Handling

| Scenario | Handling |
|----------|----------|
| Windows Credential Manager unavailable | Fall back to encrypted file, warn user |
| Credential not found | Return null, caller handles (e.g., prompt user to configure) |
| Keytar native module fails to load | Log error, fall back to file backend |
| Credential store corrupted | Clear affected entries, user re-enters keys |
| Migration fails midway | Partial migration OK — re-run picks up remaining |
| Credential bridge called without valid secret | Return 401 |

---

## 8. Security Considerations

- **DPAPI binding**: Windows Credential Manager encrypts per-user. Other Windows users cannot read.
- **Memory exposure**: Secrets held in memory only during use, not cached long-term.
- **IPC validation**: Credential IPC channels validate sender is main window only.
- **Bridge security**: Internal credential bridge requires X-Desktop-Secret and 127.0.0.1 origin.
- **Log sanitization**: Credential values never logged (existing sanitizer catches `sk-`, `ak-`, etc.).
- **Fallback encryption**: AES-256-GCM with machine-derived key. Not as strong as DPAPI but acceptable for single-user desktop.
- **No credential export**: No API to bulk-export all credentials. Individual retrieval only.

---

## 9. Testing Strategy

### Unit Tests
- KeytarBackend: set/get/delete/list round-trip.
- EncryptedFileBackend: encrypt/decrypt correctness, file persistence.
- Migration: detect plaintext → migrate → verify sentinel written.
- Validation: reject invalid service/account names.

### Integration Tests
- Full flow: frontend stores key → backend retrieves via bridge → uses for API call.
- Local secret: generated → persisted → survives restart → same value.
- Fallback: disable keytar → file backend activates → credentials accessible.
- Process manager: secrets injected into child process env correctly.

### Security Tests
- Credential bridge rejects requests without X-Desktop-Secret.
- Credential bridge rejects requests from non-localhost.
- IPC credential channels reject calls from non-main window.
- Plaintext API keys not present in any log output.
- Credential file encrypted (cannot read with text editor).

---

## 10. Cloud Mode Compatibility

- Credential service not initialized in Cloud mode.
- Cloud continues using environment variables and Kubernetes secrets.
- No `keytar` dependency loaded in Cloud Docker builds.
- Credential IPC channels not registered in Cloud mode.

---

## 11. Acceptance Criteria

- [ ] Model API keys stored in Windows Credential Manager (not plaintext).
- [ ] Local secret persists across application restart.
- [ ] Backend services can retrieve API keys via credential bridge.
- [ ] Fallback to encrypted file works when Credential Manager unavailable.
- [ ] Migration from plaintext config works on first Phase 2 boot.
- [ ] No secrets appear in log files or diagnostics export.
- [ ] Credential IPC channels enforce sender validation.
- [ ] Cloud mode unaffected (no credential service initialized).

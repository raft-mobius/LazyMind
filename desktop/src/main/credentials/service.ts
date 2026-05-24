export interface CredentialService {
  set(service: string, account: string, secret: string): Promise<void>;
  get(service: string, account: string): Promise<string | null>;
  delete(service: string, account: string): Promise<void>;
  list(service: string): Promise<string[]>;
  isAvailable(): Promise<boolean>;
}

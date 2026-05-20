import crypto from 'crypto';
import { LOCAL_SECRET_LENGTH } from '../../shared/constants';

export function generateLocalSecret(): string {
  return crypto.randomBytes(LOCAL_SECRET_LENGTH).toString('hex');
}

import { describe, it, expect } from 'vitest';
import { sanitize } from '../src/main/logger/sanitizer';

describe('sanitizer', () => {
  it('redacts sk-xxx API keys', () => {
    const input = 'Using key sk-abcdef1234567890123456789012 for auth';
    const result = sanitize(input);
    expect(result).not.toContain('sk-abcdef1234567890123456789012');
    expect(result).toContain('sk-***REDACTED***');
  });

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig';
    const result = sanitize(input);
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(result).toContain('Bearer ***REDACTED***');
  });

  it('redacts X-Desktop-Secret header', () => {
    const input = 'X-Desktop-Secret: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
    const result = sanitize(input);
    expect(result).not.toContain('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4');
    expect(result).toContain('X-Desktop-Secret: ***REDACTED***');
  });

  it('redacts database URLs with passwords', () => {
    const input = 'postgres://admin:s3cretP@ss@localhost:5432/lazymind';
    const result = sanitize(input);
    expect(result).not.toContain('s3cretP@ss');
    expect(result).toContain('postgres://***:***@');
  });

  it('redacts OPENAI_API_KEY env var', () => {
    const input = 'OPENAI_API_KEY=sk-proj-abc123xyz456';
    const result = sanitize(input);
    expect(result).toContain('OPENAI_API_KEY=***REDACTED***');
    expect(result).not.toContain('sk-proj-abc123xyz456');
  });

  it('redacts token= parameters', () => {
    const input = 'Refreshing token=abc123xyz456 from cache';
    const result = sanitize(input);
    expect(result).not.toContain('abc123xyz456');
    expect(result).toContain('token=***REDACTED***');
  });

  it('redacts password= parameters', () => {
    const input = 'Login password=myS3cret123 attempt';
    const result = sanitize(input);
    expect(result).not.toContain('myS3cret123');
    expect(result).toContain('password=***REDACTED***');
  });

  it('does not modify safe text', () => {
    const input = 'Server started on port 8001. Health check OK.';
    const result = sanitize(input);
    expect(result).toBe(input);
  });
});

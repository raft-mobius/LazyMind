import { describe, it, expect } from 'vitest';
import path from 'path';
import { validatePath } from '../src/main/ipc/security';

describe('validatePath', () => {
  const allowedPrefixes = [
    'C:\\Users\\test\\AppData\\Roaming\\LazyMind',
    'C:\\Users\\test\\AppData\\Roaming\\LazyMind\\logs',
  ];

  it('accepts paths within allowed prefixes', () => {
    const result = validatePath(
      'C:\\Users\\test\\AppData\\Roaming\\LazyMind\\logs\\core.log',
      allowedPrefixes
    );
    expect(result).toBe(
      path.resolve('C:\\Users\\test\\AppData\\Roaming\\LazyMind\\logs\\core.log')
    );
  });

  it('accepts the allowed prefix itself', () => {
    const result = validatePath(
      'C:\\Users\\test\\AppData\\Roaming\\LazyMind',
      allowedPrefixes
    );
    expect(result).toBe(
      path.resolve('C:\\Users\\test\\AppData\\Roaming\\LazyMind')
    );
  });

  it('rejects path traversal with ..', () => {
    expect(() =>
      validatePath(
        'C:\\Users\\test\\AppData\\Roaming\\LazyMind\\..\\..\\secret',
        allowedPrefixes
      )
    ).toThrow('Path traversal detected');
  });

  it('rejects paths outside allowed prefixes', () => {
    expect(() =>
      validatePath('C:\\Windows\\System32\\cmd.exe', allowedPrefixes)
    ).toThrow('Path outside allowed directories');
  });

  it('rejects paths that are prefix substrings but not subdirs', () => {
    expect(() =>
      validatePath(
        'C:\\Users\\test\\AppData\\Roaming\\LazyMindEvil\\payload.txt',
        allowedPrefixes
      )
    ).toThrow('Path outside allowed directories');
  });

  it('handles forward slashes on Windows', () => {
    const result = validatePath(
      'C:/Users/test/AppData/Roaming/LazyMind/logs/core.log',
      allowedPrefixes
    );
    expect(result).toBe(
      path.resolve('C:\\Users\\test\\AppData\\Roaming\\LazyMind\\logs\\core.log')
    );
  });
});

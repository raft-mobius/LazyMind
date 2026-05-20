import path from 'path';
import { Writable } from 'stream';
import { sanitize } from './sanitizer';
import { RotatingFileWriter } from './file-writer';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';
const writers = new Map<string, RotatingFileWriter>();

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(
  level: LogLevel,
  source: string,
  message: string,
  meta?: Record<string, unknown>
): string {
  const parts = [
    `[${formatTimestamp()}]`,
    `[${level.toUpperCase()}]`,
    `[${source}]`,
    sanitize(message),
  ];
  if (meta && Object.keys(meta).length > 0) {
    parts.push(sanitize(JSON.stringify(meta)));
  }
  return parts.join(' ') + '\n';
}

function getWriter(source: string, logDir: string): RotatingFileWriter {
  if (!writers.has(source)) {
    const filePath = path.join(logDir, `${source}.log`);
    const writer = new RotatingFileWriter(filePath);
    writer.open();
    writers.set(source, writer);
  }
  return writers.get(source)!;
}

let logDir = '';

export function initLogger(dir: string, level?: LogLevel): void {
  logDir = dir;
  if (level) currentLevel = level;
}

function log(
  level: LogLevel,
  source: string,
  message: string,
  meta?: Record<string, unknown>
): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;
  if (!logDir) return;

  const formatted = formatMessage(level, source, message, meta);
  const writer = getWriter(source, logDir);
  writer.write(formatted);
}

export const logger = {
  debug(source: string, message: string, meta?: Record<string, unknown>): void {
    log('debug', source, message, meta);
  },
  info(source: string, message: string, meta?: Record<string, unknown>): void {
    log('info', source, message, meta);
  },
  warn(source: string, message: string, meta?: Record<string, unknown>): void {
    log('warn', source, message, meta);
  },
  error(source: string, message: string, meta?: Record<string, unknown>): void {
    log('error', source, message, meta);
  },
};

export function createProcessStream(
  serviceName: string
): { stdout: Writable; stderr: Writable } {
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      const text = chunk.toString();
      for (const line of text.split('\n').filter(Boolean)) {
        log('info', serviceName, line);
      }
      callback();
    },
  });

  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      const text = chunk.toString();
      for (const line of text.split('\n').filter(Boolean)) {
        log('error', serviceName, line);
      }
      callback();
    },
  });

  return { stdout, stderr };
}

export function closeAllLoggers(): void {
  for (const writer of writers.values()) {
    writer.close();
  }
  writers.clear();
}

export function getLogPath(serviceName: string): string {
  const path = require('path') as typeof import('path');
  return path.join(logDir, `${serviceName}.log`);
}

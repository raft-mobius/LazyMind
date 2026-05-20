import fs from 'fs';
import path from 'path';
import os from 'os';
import archiver from 'archiver';
import { getDataDir } from '../data-dir';
import { sanitize } from '../logger/sanitizer';
import type { DiagnosticsInfo, ServiceStatus } from '../../shared/types';

export async function exportDiagnostics(
  serviceStatuses: ServiceStatus[]
): Promise<string> {
  const dirs = getDataDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(dirs.diagnostics, `diag-${timestamp}.zip`);

  fs.mkdirSync(dirs.diagnostics, { recursive: true });

  const output = fs.createWriteStream(outputPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on('close', () => resolve(outputPath));
    archive.on('error', reject);
    archive.pipe(output);

    // System info
    archive.append(JSON.stringify(collectSystemInfo(), null, 2), {
      name: 'system-info.json',
    });

    // Service status
    archive.append(JSON.stringify(serviceStatuses, null, 2), {
      name: 'service-status.json',
    });

    // Config summary (sanitized)
    const configSummary = collectConfigSummary(dirs.config);
    archive.append(JSON.stringify(configSummary, null, 2), {
      name: 'config-summary.json',
    });

    // Logs (last 1000 lines each, sanitized)
    if (fs.existsSync(dirs.logs)) {
      const logFiles = fs.readdirSync(dirs.logs).filter((f) => f.endsWith('.log'));
      for (const logFile of logFiles) {
        const logPath = path.join(dirs.logs, logFile);
        const content = readLastLines(logPath, 1000);
        archive.append(sanitize(content), { name: `logs/${logFile}` });
      }
    }

    // Crash logs
    if (fs.existsSync(dirs.crash)) {
      const crashFiles = fs.readdirSync(dirs.crash).slice(-10);
      for (const crashFile of crashFiles) {
        const crashPath = path.join(dirs.crash, crashFile);
        const content = fs.readFileSync(crashPath, 'utf-8');
        archive.append(sanitize(content), { name: `crash/${crashFile}` });
      }
    }

    archive.finalize();
  });
}

export function collectSystemInfo(): DiagnosticsInfo {
  return {
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    version: process.env.npm_package_version || '0.1.0',
    memoryMB: Math.round(os.totalmem() / 1024 / 1024),
    diskFreeMB: 0, // populated at runtime if needed
    uptime: os.uptime(),
    services: [],
  };
}

function collectConfigSummary(configPath: string): Record<string, unknown> {
  if (!fs.existsSync(configPath)) {
    return { error: 'config file not found' };
  }
  const raw = fs.readFileSync(configPath, 'utf-8');
  return { content: sanitize(raw) };
}

function readLastLines(filePath: string, maxLines: number): string {
  if (!fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  return lines.slice(-maxLines).join('\n');
}

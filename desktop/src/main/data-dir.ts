import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { DataDirPaths } from '../shared/types';
import { DATA_DIR_NAME } from '../shared/constants';

let cachedPaths: DataDirPaths | null = null;

export function getDataDir(): DataDirPaths {
  if (cachedPaths) return cachedPaths;

  const root = resolveRootDir();
  cachedPaths = {
    root,
    config: path.join(root, 'config.yaml'),
    data: path.join(root, 'data'),
    vector: path.join(root, 'vector'),
    segment: path.join(root, 'segment'),
    uploads: path.join(root, 'uploads'),
    scanned: path.join(root, 'scanned'),
    cache: path.join(root, 'cache'),
    logs: path.join(root, 'logs'),
    diagnostics: path.join(root, 'logs', 'diagnostics'),
    crash: path.join(root, 'logs', 'crash'),
    backups: path.join(root, 'backups'),
    defaultDocs: path.join(root, 'default-docs'),
  };
  return cachedPaths;
}

export async function ensureDataDir(): Promise<void> {
  const dirs = getDataDir();

  const dirsToCreate = [
    dirs.root,
    dirs.data,
    dirs.vector,
    dirs.segment,
    dirs.uploads,
    dirs.scanned,
    dirs.cache,
    dirs.logs,
    dirs.diagnostics,
    dirs.crash,
    dirs.backups,
    dirs.defaultDocs,
  ];

  for (const dir of dirsToCreate) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await copyDefaultConfig();
  await copyDefaultDocs();
}

function resolveRootDir(): string {
  if (process.env.LAZYMIND_DATA_DIR) {
    return process.env.LAZYMIND_DATA_DIR;
  }
  const appDataPath = app.getPath('appData');
  return path.join(appDataPath, DATA_DIR_NAME);
}

async function copyDefaultConfig(): Promise<void> {
  const dirs = getDataDir();
  if (fs.existsSync(dirs.config)) return;

  const templatePath = getResourcePath('templates', 'default_config.yaml');
  if (fs.existsSync(templatePath)) {
    fs.copyFileSync(templatePath, dirs.config);
  }
}

async function copyDefaultDocs(): Promise<void> {
  const dirs = getDataDir();
  const docsSourceDir = getResourcePath('default-docs');
  if (!fs.existsSync(docsSourceDir)) return;

  const files = fs.readdirSync(docsSourceDir);
  for (const file of files) {
    const destPath = path.join(dirs.defaultDocs, file);
    if (!fs.existsSync(destPath)) {
      fs.copyFileSync(path.join(docsSourceDir, file), destPath);
    }
  }
}

function getResourcePath(...segments: string[]): string {
  return path.join(__dirname, 'resources', ...segments);
}

export function resetDataDirCache(): void {
  cachedPaths = null;
}

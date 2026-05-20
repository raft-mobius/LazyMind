import path from 'path';
import fs from 'fs';
import { protocol, net } from 'electron';
import { PROTOCOL_SCHEME } from '../shared/constants';
import { SECURITY_CONFIG } from './security/config';

let rendererDir = '';

export function setRendererDir(dir: string): void {
  rendererDir = dir;
}

export function registerProtocol(): void {
  protocol.handle(PROTOCOL_SCHEME, (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);

    // Windows: remove leading slash from /C:/... paths
    if (process.platform === 'win32' && filePath.startsWith('/')) {
      filePath = filePath.slice(1);
    }

    // Resolve against renderer dir
    let fullPath = path.join(rendererDir, filePath);

    // SPA fallback: if file doesn't exist and has no extension, serve index.html
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      fullPath = path.join(rendererDir, 'index.html');
    }

    if (!fs.existsSync(fullPath)) {
      return new Response('Not found', { status: 404 });
    }

    const fileUrl = `file://${fullPath.replace(/\\/g, '/')}`;
    const response = net.fetch(fileUrl);
    return response.then((res) => {
      const headers = new Headers(res.headers);
      headers.set('Content-Security-Policy', SECURITY_CONFIG.csp);
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    });
  });
}

export function getRendererURL(): string {
  if (process.env.VITE_DEV_SERVER_URL) {
    return process.env.VITE_DEV_SERVER_URL;
  }
  return `${PROTOCOL_SCHEME}://app/index.html`;
}

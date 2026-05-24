import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CredentialService } from '../credentials/service';

export function createCredentialBridge(credService: CredentialService, localSecret: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = req.url || '';
    const match = url.match(/^\/internal\/credentials\/([^/]+)\/([^/]+)$/);
    if (!match) return false;

    const clientSecret = req.headers['x-desktop-secret'];
    if (clientSecret !== localSecret) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return true;
    }

    const remoteAddr = req.socket.remoteAddress;
    if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return true;
    }

    const [, service, account] = match;

    try {
      if (req.method === 'GET') {
        const value = await credService.get(decodeURIComponent(service), decodeURIComponent(account));
        if (value === null) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ value }));
        }
      } else if (req.method === 'DELETE') {
        await credService.delete(decodeURIComponent(service), decodeURIComponent(account));
        res.writeHead(204);
        res.end();
      } else {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error' }));
    }

    return true;
  };
}

import net from 'net';

export function isPortInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, host);
  });
}

export async function waitForPort(
  port: number,
  host = '127.0.0.1',
  timeoutMs = 30000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const inUse = await isPortInUse(port, host);
    if (inUse) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

import http from 'node:http';
import net from 'node:net';
import Logger from '#infra/logging/Logger.js';
export function startSandboxProxy(options) {
    return new Promise((resolve, reject) => {
        const domainSet = new Set(options.allowedDomains.map((d) => d.toLowerCase()));
        let connections = 0;
        let blocked = 0;
        const server = http.createServer((_req, res) => {
            res.writeHead(405, { 'Content-Type': 'text/plain' });
            res.end('Only CONNECT method is supported');
        });
        server.on('connect', (req, clientSocket, head) => {
            const target = req.url || '';
            const [hostname, portStr] = target.split(':');
            const port = Number.parseInt(portStr || '443', 10);
            if (!isDomainAllowed(hostname, domainSet)) {
                blocked++;
                Logger.info(`[SandboxProxy] blocked: ${hostname}:${port}`);
                clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                clientSocket.end();
                return;
            }
            connections++;
            const serverSocket = net.connect(port, hostname, () => {
                clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                serverSocket.write(head);
                serverSocket.pipe(clientSocket);
                clientSocket.pipe(serverSocket);
            });
            serverSocket.on('error', (err) => {
                Logger.warn(`[SandboxProxy] upstream error for ${hostname}:${port}: ${err.message}`);
                clientSocket.end();
            });
            clientSocket.on('error', () => {
                serverSocket.destroy();
            });
        });
        server.on('error', reject);
        server.listen(options.port || 0, '127.0.0.1', () => {
            const addr = server.address();
            if (!addr || typeof addr === 'string') {
                reject(new Error('Failed to bind proxy'));
                return;
            }
            const handle = {
                port: addr.port,
                address: `127.0.0.1:${addr.port}`,
                get connections() {
                    return connections;
                },
                get blocked() {
                    return blocked;
                },
                stop: () => new Promise((res) => {
                    server.close(() => res());
                    setTimeout(() => res(), 2000);
                }),
            };
            Logger.info(`[SandboxProxy] started on 127.0.0.1:${addr.port} (${domainSet.size} allowed domains)`);
            resolve(handle);
        });
    });
}
/**
 * 域名匹配：精确匹配或通配子域名。
 * 白名单 'github.com' 允许 'github.com' 和 'api.github.com'。
 */
function isDomainAllowed(hostname, allowed) {
    const h = hostname.toLowerCase();
    if (allowed.has(h)) {
        return true;
    }
    for (const d of allowed) {
        if (h.endsWith(`.${d}`)) {
            return true;
        }
    }
    return false;
}

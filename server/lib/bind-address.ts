/**
 * Listen address from config.service.host. Default is loopback.
 */
import type { Server } from 'http';

export const DEFAULT_BIND_HOST = '127.0.0.1';

export function isValidBindHost(host: string): boolean {
    if (!host || host.length > 253) return false;
    if (host === '*' || host.includes('/') || /\s/.test(host)) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
        return host.split('.').every((octet) => {
            const n = Number(octet);
            return octet === String(n) && n >= 0 && n <= 255;
        });
    }
    if (host.includes(':')) return false;
    return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
        host
    );
}

export function resolveBindHost(service?: { host?: unknown } | null): string {
    const raw = typeof service?.host === 'string' ? service.host.trim() : '';
    if (raw && isValidBindHost(raw)) return raw;
    return DEFAULT_BIND_HOST;
}

type ListenApp = {
    listen: (port: number, host: string, cb?: () => void) => Server;
};

export function startHttpServer(app: ListenApp, port: number, host: string, cb?: () => void): Server {
    return app.listen(port, host, cb);
}

/**
 * Listen address from config.service.host. Default is IPv4 loopback.
 * IPv6 literals are accepted with or without brackets.
 */
import net from 'net';
import type { Server } from 'http';

export const DEFAULT_BIND_HOST = '127.0.0.1';

/** Strip one pair of brackets from an IPv6 literal. */
export function normalizeBindHost(host: string): string {
    const trimmed = host.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed.length > 2) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

export function isValidBindHost(host: string): boolean {
    if (!host || /\s/.test(host)) return false;
    const h = normalizeBindHost(host);
    if (!h || h === '*' || h.includes('/')) return false;
    if (net.isIP(h) === 6) return true;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
        return h.split('.').every((octet) => {
            const n = Number(octet);
            return octet === String(n) && n >= 0 && n <= 255;
        });
    }
    if (h.includes(':') || h.includes('[')) return false;
    if (h.length > 253) return false;
    return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
        h
    );
}

export function resolveBindHost(service?: { host?: unknown } | null): string {
    const raw = typeof service?.host === 'string' ? normalizeBindHost(service.host) : '';
    if (raw && isValidBindHost(raw)) return raw;
    return DEFAULT_BIND_HOST;
}

type ListenApp = {
    listen: (port: number, host: string, cb?: () => void) => Server;
};

export function startHttpServer(app: ListenApp, port: number, host: string, cb?: () => void): Server {
    return app.listen(port, host, cb);
}

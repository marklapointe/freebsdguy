/**
 * How many proxies may set X-Forwarded-For.
 * Default is loopback only, so a client on a direct bind cannot spoof its address.
 */
export type TrustProxyValue = boolean | number | string;

export function parseTrustProxy(value: unknown): { value: TrustProxyValue; ok: boolean } {
    if (value === undefined || value === null || value === '') return { value: 'loopback', ok: true };
    if (typeof value === 'boolean') return { value, ok: true };
    if (typeof value === 'number') {
        if (Number.isInteger(value) && value >= 0) return { value, ok: true };
        return { value: 'loopback', ok: false };
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        const lower = trimmed.toLowerCase();
        if (lower === 'loopback' || lower === 'linklocal' || lower === 'uniquelocal') return { value: lower, ok: true };
        if (lower === 'false') return { value: false, ok: true };
        if (lower === 'true') return { value: true, ok: true };
        if (/^\d+$/.test(trimmed)) return { value: Number(trimmed), ok: true };
        if (/^[0-9a-fA-F.:/,\s]+$/.test(trimmed)) return { value: trimmed, ok: true };
    }
    return { value: 'loopback', ok: false };
}

export function resolveTrustProxy(value: unknown): TrustProxyValue {
    return parseTrustProxy(value).value;
}

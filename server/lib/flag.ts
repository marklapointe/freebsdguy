/**
 * One definition of an on/off switch for config.json, front matter and table markers
 * (Track #1682). true/false, "on"/"off", "yes"/"no", "true"/"false", 1/0 and "1"/"0".
 * Anything else is undefined, so the next setting down applies.
 */
export function asFlag(v: unknown): boolean | undefined {
    if (typeof v === 'boolean') return v;
    if (v === 1 || v === 0) return v === 1;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (['true', 'on', 'yes', '1'].includes(s)) return true;
        if (['false', 'off', 'no', '0'].includes(s)) return false;
    }
    return undefined;
}

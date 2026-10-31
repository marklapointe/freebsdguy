/**
 * Read a secret from a file that must be mode 0600.
 * Group/other bits, or any mode other than 0600, are refused.
 */
import fs from 'fs';

export class SecretFileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SecretFileError';
    }
}

export function permissionBits(mode: number): number {
    return mode & 0o777;
}

export function assertMode0600(mode: number, label = 'Secret file'): void {
    const bits = permissionBits(mode);
    if (bits !== 0o600) {
        const shown = bits.toString(8).padStart(4, '0');
        throw new SecretFileError(`${label} mode is ${shown}, must be 0600`);
    }
}

export function readMode0600File(filePath: string): string {
    let st: fs.Stats;
    try {
        st = fs.statSync(filePath);
    } catch {
        throw new SecretFileError(`Cannot read secret file: ${filePath}`);
    }
    assertMode0600(st.mode, 'Secret file');
    const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
    const trimmed = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
    if (!trimmed || trimmed.includes('\n')) {
        throw new SecretFileError('Secret file must contain a single non-empty line');
    }
    return trimmed;
}

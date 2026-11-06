// Track #1682 slice P: link-preview config keys are validated (they land in HTML attributes).
import { describe, it, expect } from 'vitest';
import { sanitizeConfig } from '../server/lib/config';

describe('config: siteTagline / shareImage / siteUrl', () => {
    it('accepts sane values', () => {
        const { config, warnings } = sanitizeConfig({ siteTagline: 'FreeBSD work', shareImage: '/api/getimage?fileName=share.png', siteUrl: 'https://freebsdguy.ca' });
        expect(config.siteTagline).toBe('FreeBSD work');
        expect(config.shareImage).toBe('/api/getimage?fileName=share.png');
        expect(config.siteUrl).toBe('https://freebsdguy.ca');
        expect(warnings.filter(w => /siteTagline|shareImage|siteUrl/.test(w))).toEqual([]);
    });
    it('rejects attribute-breaking or non-http values', () => {
        const { config, warnings } = sanitizeConfig({ shareImage: 'javascript:alert(1)', siteUrl: 'https://x.ca/"><script>', siteTagline: 'x'.repeat(301) });
        expect(config.shareImage).toBeUndefined();
        expect(config.siteUrl).toBeUndefined();
        expect(config.siteTagline).toBeUndefined();
        expect(warnings.join(' ')).toMatch(/shareImage invalid/);
        expect(warnings.join(' ')).toMatch(/siteUrl invalid/);
    });
});

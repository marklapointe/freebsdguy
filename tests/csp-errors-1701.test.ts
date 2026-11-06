// Track #1701 Adversary F4/F5: strict CSP, no Express fingerprint on errors.
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app } from '../server/index.ts';

const csp = (h: any) => String(h['content-security-policy'] || '');
const directive = (c: string, name: string) =>
    (c.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + ' ')) || '');

describe('F4: Content-Security-Policy is strict', () => {
    it('script-src has no unsafe-inline / unsafe-eval', async () => {
        const r = await request(app).get('/api/health');
        const s = directive(csp(r.headers), 'script-src');
        expect(s).toContain("'self'");
        expect(s).not.toContain('unsafe-inline');
        expect(s).not.toContain('unsafe-eval');
    });
    it('connect-src has no api.openai.com and no localhost/127.0.0.1 wildcards', async () => {
        const r = await request(app).get('/api/health');
        const c = csp(r.headers);
        expect(c).not.toContain('api.openai.com');
        expect(c).not.toMatch(/localhost:\*/);
        expect(c).not.toMatch(/127\.0\.0\.1:\*/);
        expect(directive(c, 'connect-src')).toContain("'self'");
    });
});

describe('F5: errors do not leak Express', () => {
    it('no X-Powered-By', async () => {
        const r = await request(app).get('/api/health');
        expect(r.headers['x-powered-by']).toBeUndefined();
    });
    for (const [m, p] of [['post', '/api/mcp'], ['post', '/api/nope'], ['get', '/api/nope'], ['delete', '/mcp/x']] as const) {
        it(`${m.toUpperCase()} ${p} -> 404 JSON without "Cannot ${m.toUpperCase()}"`, async () => {
            const r = await (request(app) as any)[m](p);
            expect(r.status).toBe(404);
            expect(r.headers['content-type']).toMatch(/application\/json/);
            expect(r.text).not.toMatch(/Cannot (GET|POST|PUT|DELETE)/);
            expect(r.text).not.toMatch(/<pre>|Express|at .*\.(js|ts):\d+/);
            expect(JSON.parse(r.text)).toEqual({ message: 'Not Found' });
        });
    }
    it('malformed JSON -> 400 JSON, no stack trace or parser name', async () => {
        const r = await request(app).post('/api/auth/login').set('content-type', 'application/json').send('{bad');
        expect(r.status).toBe(400);
        expect(r.headers['content-type']).toMatch(/application\/json/);
        expect(r.text).not.toMatch(/SyntaxError|body-parser|at .*\.(js|ts):\d+|<pre>/);
    });
});

import { jsonErrorHandler } from '../server/register-routes.ts';

describe('jsonErrorHandler', () => {
    const makeRes = (headersSent = false) => {
        const res: any = {
            headersSent,
            code: 0,
            body: undefined,
            status(code: number) { this.code = code; return this; },
            json(body: unknown) { this.body = body; return this; }
        };
        return res;
    };

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('err {status:413} -> 413 {message:"Error"}', () => {
        const res = makeRes();
        const next = vi.fn();
        jsonErrorHandler({ status: 413 } as any, {} as any, res, next as any);
        expect(res.code).toBe(413);
        expect(res.body).toEqual({ message: 'Error' });
        expect(next).not.toHaveBeenCalled();
    });

    it('err {statusCode:404} -> 404', () => {
        const res = makeRes();
        const next = vi.fn();
        jsonErrorHandler({ statusCode: 404 } as any, {} as any, res, next as any);
        expect(res.code).toBe(404);
        expect(res.body).toEqual({ message: 'Error' });
        expect(next).not.toHaveBeenCalled();
    });

    it('err {status:400} -> {message:"Bad Request"}', () => {
        const res = makeRes();
        const next = vi.fn();
        jsonErrorHandler({ status: 400 } as any, {} as any, res, next as any);
        expect(res.code).toBe(400);
        expect(res.body).toEqual({ message: 'Bad Request' });
        expect(next).not.toHaveBeenCalled();
    });

    it('new Error("secret /path at x.ts:1") -> 500, body has no "secret"', () => {
        const res = makeRes();
        const err = new Error('secret /path at x.ts:1');
        jsonErrorHandler(err, {} as any, res, vi.fn());
        expect(res.code).toBe(500);
        expect(res.body).toEqual({ message: 'Internal Server Error' });
        expect(JSON.stringify(res.body)).not.toContain('secret');
    });

    it('err null -> 500', () => {
        const res = makeRes();
        jsonErrorHandler(null, {} as any, res, vi.fn());
        expect(res.code).toBe(500);
        expect(res.body).toEqual({ message: 'Internal Server Error' });
    });

    it('status 200 (out of range) -> 500', () => {
        const res = makeRes();
        jsonErrorHandler({ status: 200 } as any, {} as any, res, vi.fn());
        expect(res.code).toBe(500);
        expect(res.body).toEqual({ message: 'Internal Server Error' });
    });

    it('headersSent=true -> next called once with err and code stays 0', () => {
        const res = makeRes(true);
        const next = vi.fn();
        const err = { status: 500, message: 'boom' };
        jsonErrorHandler(err, {} as any, res, next as any);
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(err);
        expect(res.code).toBe(0);
        expect(res.body).toBeUndefined();
    });
});

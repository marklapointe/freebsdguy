/**
 * P0 D1/D2: dangerous URL schemes and raw HTML are rejected at write time, and
 * the client render helper strips them even without a CSP.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { app } from '../server/index.ts';
import { mintToken } from '../server/lib/api-tokens.ts';
import { resetRateLimits } from '../server/lib/rate-limit.ts';
import { validatePostContent } from '../server/lib/post-content.ts';
import { isDangerousUrl, isSafeUrl } from '../server/lib/url-safety.ts';
import { sanitizeMarkdownHtml } from '../src/lib/sanitize-md.ts';

const postsDir = path.resolve(process.cwd(), 'tests/tmp/posts');

const BAD_BODIES: Record<string, string> = {
    'js link': '[x](javascript:alert(1))',
    'mixed case': '[x](JaVaScRiPt:alert(1))',
    'entity': '<a href="java&#115;cript:alert(1)">x</a>',
    'hex entity': '<a href="java&#x73;cript:alert(1)">x</a>',
    'colon entity': '<a href="javascript&colon;alert(1)">x</a>',
    'tab': '<a href="java\tscript:alert(1)">x</a>',
    'percent': '[x](%6a%61vascript:alert(1))',
    'data html': '[x](data:text/html,<script>alert(1)</script>)',
    'vbscript': '[x](vbscript:msgbox(1))',
    'image js': '![x](javascript:alert(1))',
    'reference': '[id]: javascript:alert(1)\n\n[x][id]',
    'ordered paren ref def': '1) [id]: javascript:alert(1)\n\n[x][id]',
    'multiline label ref def': '[id\nx]: javascript:alert(1)\n\n[x][id x]',
    'autolink': '<javascript:alert(1)>',
    'a href': '<a href="javascript:alert(1)">x</a>',
    'form action': '<form action="javascript:alert(1)"><button>x</button></form>',
    'img onerror': '<img src=x onerror=alert(1)>',
    'svg onload': '<svg onload=alert(1)></svg>',
    'iframe': '<iframe src="https://evil.example"></iframe>',
    'base': '<base href="https://evil.example/">',
    'script': '<script>alert(1)</script>',
    'object': '<object data="x"></object>',
    'embed': '<embed src="x">',
    'meta': '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    'srcdoc': '<div srcdoc="x">',
    'data image svg': '![x](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)',
    'indented closing fence': '```\nx\n  ```\n<script>alert(1)</script>',
    'code span across blank lines (link)': '`\n\n[x](javascript:alert(1))\n\n`',
    'code span across blank lines (script)': '`\n\n<script>alert(1)</script>\n\n`',
    'code span across blank lines (img)': '`\n\n<img src=x onerror=alert(1)>\n\n`',
    'code span across blank lines (two spans)': 'a `\n\n<script>alert(1)</script>\n\nb `',
    'reference with newline after colon': '[id]:\njavascript:alert(1)\n\n[x][id]',
    'reference in blockquote': '> [id]: javascript:alert(1)\n\n[x][id]',
    'reference in list': '- [id]: javascript:alert(1)',
    'backtick inside an attribute value': '<a title="`" href="javascript:alert(1)">x</a> and `m`',
    'escaped backticks around a link': '\\`[x](javascript:alert(1))\\`',
    'escaped backticks around a script': '\\`<script>alert(1)</script>\\`',
    'reference label with escaped bracket': '[a\\]b]: javascript:alert(1)\n\n[x][a\\]b]',
    'indented fence in a bullet list': '- foo\n  ```\n[x](javascript:alert(1))\n```',
    'indented fence in an ordered list': '1. foo\n   ```\n[x](javascript:alert(1))\n```',
    'newline inside scheme (link)': '[x]( java\nscript:alert(1))',
    'newline inside scheme (image)': '![x]( java\nscript:alert(1))',
    'newline inside scheme (ref def)': '[id]: java\nscript:alert(1)\n\n[x][id]',
    'tab and CR inside scheme (link)': '[x](java\t\rscript:alert(1))',
    'control char inside scheme (link)': '[x](java\u0001script:alert(1))',
    'style import': '<style>@import url(https://evil.example/x.css);</style>',
    'raw style': '<style>*{display:none}</style>',
    'noscript mxss': '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    'noscript plain': '<noscript>x</noscript>',
    'image attribute breakout': '![x](x" onerror="alert(1))',
    'link quote breakout': '[x](x" onmouseover="alert(1))',
    'image bracketed quote breakout (event handler)': '![x](<x" onerror="alert(1)>)',
    'link bracketed quote breakout (event handler)': '[x](<x" onmouseover="alert(1)>)',
    'image bracketed quote breakout (relative)': '![x](<./foo"bar>)',
    'image bracketed quote breakout (no space)': '![x](<foo.jpg"onclick="x>)',
    'link bracketed quote breakout (relative)': '[x](<./a"b>)',
    'link bracketed quote breakout (absolute)': '[x](<https://e.com/a"b>)',
    'ref def quote breakout': '[id]: x"onerror="alert(1)\n\n![x][id]',
    'ref def bracketed quote breakout': '[id]: <x"onerror="alert(1)>\n\n![x][id]',
    'ref def scheme split at the colon (javascript)': '[id]: javascript\n:alert(1)\n\n[x][id]',
    'ref def scheme split at the colon (data)': '[id]: data\n:text/html,x\n\n[x][id]',
    'srcset': '<img srcset="javascript:x 1x">',
    'srcset second candidate': '<img srcset="/a.png 1x, javascript:x 2x">'
};

let tmp = '';
let pat = '';
const slugs: string[] = [];

function rm() {
    for (const s of slugs) fs.rmSync(path.join(postsDir, `${s}.md`), { force: true });
    slugs.length = 0;
}

function mcp(name: string, args: Record<string, unknown>) {
    return request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${pat}`)
        .set('MCP-Protocol-Version', '2025-06-18')
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
}

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdweb-d-'));
    vi.stubEnv('TOKENS_PATH', path.join(tmp, 'tokens.json'));
    vi.stubEnv('AUDIT_LOG_PATH', path.join(tmp, 'audit.log'));
    fs.mkdirSync(postsDir, { recursive: true });
    pat = mintToken('admin', 'd', 'write').plaintext;
    resetRateLimits();
});

afterEach(() => {
    vi.unstubAllEnvs();
    rm();
    fs.rmSync(tmp, { recursive: true, force: true });
    resetRateLimits();
});

describe('validatePostContent', () => {
    for (const [name, body] of Object.entries(BAD_BODIES)) {
        it(`rejects ${name}`, () => {
            expect(validatePostContent({ content: body }).ok).toBe(false);
        });
    }

    it('names an image source as an image and a link as a link', () => {
        const img = validatePostContent({ content: '![x](javascript:alert(1))' });
        const link = validatePostContent({ content: '[x](javascript:alert(1))' });
        expect(img.ok === false && img.error).toContain('URL scheme in image source is not allowed');
        expect(link.ok === false && link.error).toContain('URL scheme in link is not allowed');
    });

    it('rejects dangerous schemes and HTML in the summary and title', () => {
        expect(validatePostContent({ content: 'ok', summary: '[x](javascript:alert(1))' }).ok).toBe(false);
        expect(validatePostContent({ content: 'ok', summary: '<img src=x onerror=alert(1)>' }).ok).toBe(false);
        expect(validatePostContent({ content: 'ok', title: '<script>x</script>' }).ok).toBe(false);
    });

    it('accepts safe links, relative paths, and code samples', () => {
        const good = [
            '[a](https://example.com) [b](http://example.com/x?y=1) [c](mailto:a@b.c) [d](/path) [e](#frag) [f](rel/path.md)',
            '![i](/api/images/x.webp) ![j](data:image/png;base64,iVBORw0KGgo=)',
            '<https://example.com>',
            '```html\n<script>alert(1)</script>\n<a href="javascript:x">y</a>\n```',
            '```\n<script>safe()</script>\n  ```\n\nhello',
            'inline `<script>` and `[x](javascript:y)` code',
            '~~~\n<iframe src=x></iframe>\n~~~',
            'plain text with onclick = in prose? no tag',
            'a `one` and `two` span\n\nthen [ok](https://example.com)',
            '``a ` tick``\n\n[ok](/x)',
            'real `\\`code` span',
            'a <b and `<script>` here',
            '[x](https://example.com "a title") ![i](/a.png "t")',
            '[x]( https://e.com "title")',
            '[x](<./a b.png>) ![i](<https://e.com/a b.png> "t")',
            '[id]: https://example.com "Title"\n\n[x][id]',
            '[home]: foo\nNote: x\n\n[x][home]',
            '[id]: bar\nSee also: more\n\n[x][id]',
            '> quote with [id]: text but no url scheme\n\n- [id]: https://example.com'
        ];
        for (const content of good) expect(validatePostContent({ content, summary: 'A fine summary', title: 'T' }), content).toEqual({ ok: true });
    });
});

describe('linear-time scan and size cap', () => {
    it('does not go quadratic on pathological input', () => {
        for (const content of [']]('.repeat(100_000), '['.repeat(200_000), '`a``b```c````d'.repeat(20_000)]) {
            const t = Date.now();
            validatePostContent({ content });
            expect(Date.now() - t).toBeLessThan(200);
        }
    });

    it('keeps the bounded multiline reference-definition scan linear', () => {
        const t = Date.now();
        const r = validatePostContent({ content: '[\n'.repeat(50_000) });
        expect(Date.now() - t).toBeLessThan(200);
        expect(r.ok).toBe(true);
    });

    it('refuses an oversized field', () => {
        const r = validatePostContent({ content: 'a'.repeat(1024 * 1024 + 1) });
        expect(r.ok === false && r.error).toContain('Post content is too large');
    });
});

describe('sanitizer drops name (DOM clobbering)', () => {
    it('removes the name attribute', () => {
        expect(sanitizeMarkdownHtml('<img name="cookie" src="/ok.png">')).not.toContain('name=');
    });
});

describe('unclosed < is literal text', () => {
    it('still refuses a real script after an unclosed <', () => {
        expect(validatePostContent({ content: 'a <b and <script>alert(1)</script>', summary: 'A fine summary', title: 'T' }).ok).toBe(false);
    });
});

describe('write paths reject the corpus', () => {
    it('MCP create_post and update_post refuse every payload and write nothing', async () => {
        for (const [name, body] of Object.entries(BAD_BODIES)) {
            for (const tool of ['create_post', 'update_post']) {
                const slug = `xss-${tool}-${name.replace(/\W/g, '')}`;
                slugs.push(slug);
                const res = await mcp(tool, { slug, title: 't', content: body });
                expect(res.body.result?.isError, `${tool} ${name}`).toBe(true);
                expect(fs.existsSync(path.join(postsDir, `${slug}.md`)), `${tool} ${name}`).toBe(false);
            }
        }
    });

    it('REST POST /api/posts refuses every payload with 400 and writes nothing', async () => {
        for (const [name, body] of Object.entries(BAD_BODIES)) {
            const slug = `xss-rest-${name.replace(/\W/g, '')}`;
            slugs.push(slug);
            const res = await request(app)
                .post('/api/posts')
                .set('Authorization', `Bearer ${pat}`)
                .send({ slug, title: 't', content: body });
            expect(res.status, name).toBe(400);
            expect(fs.existsSync(path.join(postsDir, `${slug}.md`)), name).toBe(false);
        }
    });

    it('a fenced code block with <script> still saves (MCP and REST)', async () => {
        const content = 'Example:\n\n```html\n<script>alert(1)</script>\n```\n\nand `<iframe>` inline';
        slugs.push('xss-code-mcp', 'xss-code-rest');
        const a = await mcp('create_post', { slug: 'xss-code-mcp', title: 't', content });
        expect(a.body.result?.isError).toBeFalsy();
        const b = await request(app)
            .post('/api/posts')
            .set('Authorization', `Bearer ${pat}`)
            .send({ slug: 'xss-code-rest', title: 't', content });
        expect(b.status).toBe(200);
    });
});

describe('publish_post re-checks what is on disk', () => {
    for (const [name, body] of [
        ['script', '<script>alert(1)</script>'],
        ['javascript: link', '[x](javascript:alert(1))']
    ]) {
        it(`refuses a draft file written directly on disk with a ${name}`, async () => {
            const slug = `xss-publish-${name.replace(/\W/g, '')}`;
            slugs.push(slug);
            const file = path.join(postsDir, `${slug}.md`);
            fs.writeFileSync(file, `---\ntitle: t\nstatus: draft\nauthor: admin\n---\n${body}\n`);
            const before = fs.readFileSync(file, 'utf8');
            const res = await mcp('publish_post', { slug });
            expect(res.body.result?.isError).toBe(true);
            expect(fs.readFileSync(file, 'utf8')).toBe(before);
        });
    }
});

describe('server and client share one URL canonicalizer', () => {
    const urls = [
        'javascript&lpar;1)',
        'javascript&colon;alert&lpar;1&rpar;',
        'java\u3000script:alert(1)',
        'java\u1680script:alert(1)',
        'java\u202fscript:alert(1)',
        'java\u205fscript:alert(1)',
        'https://ok.example/',
        '/rel',
        '#frag'
    ];
    for (const u of urls) {
        it(`isDangerousUrl and isSafeUrl agree on ${JSON.stringify(u)}`, () => {
            expect(isSafeUrl(u)).toBe(!isDangerousUrl(u));
            expect(isSafeUrl(u, true)).toBe(!isDangerousUrl(u, true));
        });
    }
    it('treats &lpar; and U+3000 tricks as dangerous', () => {
        expect(isDangerousUrl('javascript:alert&lpar;1&rpar;')).toBe(true);
        expect(isDangerousUrl('java\u3000script:alert(1)')).toBe(true);
        expect(isSafeUrl('java\u3000script:alert(1)')).toBe(false);
        expect(isSafeUrl('javascript&colon;alert&lpar;1&rpar;')).toBe(false);
    });
    it('the client sanitizer strips an href that only the full entity table decodes', () => {
        expect(sanitizeMarkdownHtml('<a href="javascript&colon;alert&lpar;1&rpar;">x</a>')).not.toMatch(/href/);
        expect(sanitizeMarkdownHtml('<a href="java\u3000script:alert(1)">x</a>')).not.toMatch(/href/);
    });
});

describe('client render helper', () => {
    it('keeps a task-list checkbox and drops any other input', () => {
        const ok = sanitizeMarkdownHtml('<ul><li><input type="checkbox" checked disabled onclick="x()" name="n"> done</li></ul>');
        expect(ok).toContain('<input');
        expect(ok).toContain('type="checkbox"');
        expect(ok).toContain('checked');
        expect(ok).toContain('disabled');
        expect(ok).not.toMatch(/onclick|name=/);
        for (const bad of ['<input type="text" value="x">', '<input>', '<input type="password">', '<input type="image" src="x">']) {
            expect(sanitizeMarkdownHtml(`<p>a${bad}b</p>`), bad).not.toContain('<input');
        }
    });

    // Write-time rejection is the contract for style/noscript; this is the render-time backstop only.
    it('strips script, iframe, object, embed, form, base, style, handlers, srcdoc and bad schemes', () => {
        const html = [
            '<p onclick="x()">hi</p>',
            '<script>alert(1)</script>',
            '<iframe src="https://evil.example"></iframe>',
            '<object data="x"></object><embed src="x">',
            '<form action="https://evil.example"><input></form>',
            '<base href="https://evil.example/">',
            '<style>*{display:none}</style>',
            '<img src="x" onerror="alert(1)">',
            '<a href="javascript:alert(1)">j</a>',
            '<a href="JaVaScRiPt:alert(1)">j2</a>',
            '<a href="data:text/html,x">d</a>',
            '<a href="https://ok.example/">ok</a>',
            '<a href="/rel">rel</a>',
            '<div srcdoc="x">s</div>',
            '<svg onload="alert(1)"></svg>'
        ].join('');
        const out = sanitizeMarkdownHtml(html);
        expect(out).not.toMatch(/<script|<iframe|<object|<embed|<form|<base|<style|onclick|onerror|onload|srcdoc|javascript:|data:text/i);
        expect(out).toContain('https://ok.example/');
        expect(out).toContain('href="/rel"');
        expect(out).toContain('hi');
    });

    it('drops a style written with a CSS escape (u\\72l( is url()', () => {
        const out = sanitizeMarkdownHtml('<span style="background:u\\72l(https://evil.example/b.gif)">hi</span>');
        expect(out).not.toContain('style=');
        expect(out).toContain('hi');
    });

    it('keeps highlight.js, KaTeX and Mermaid markup', () => {
        const html =
            '<pre><code class="language-js"><span class="hljs-keyword">const</span> x</code></pre>' +
            '<span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow></semantics></math></span><span class="katex-html" aria-hidden="true" style="height:1em"><span class="mord">x</span></span></span>' +
            '<div class="md-editor-mermaid" data-line="3">graph TD</div>' +
            '<img src="/api/images/a.webp" alt="a">' +
            '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>';
        const out = sanitizeMarkdownHtml(html);
        expect(out).toContain('hljs-keyword');
        expect(out).toContain('katex-html');
        expect(out).toContain('<mi>x</mi>');
        expect(out).toContain('md-editor-mermaid');
        expect(out).toContain('src="/api/images/a.webp"');
        expect(out).toContain('<td>c</td>');
    });
});

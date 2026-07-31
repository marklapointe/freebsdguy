# Development and contribution

This document is for people **changing MDWeb’s code**, not for operators who only want a blog online. End-user install and daily use live in the root [README.md](../README.md).

## Prerequisites

- Node.js 18+
- npm
- Optional: FreeBSD VM or host for package/regression work

## Local app

```bash
npm install
npm run dev          # http://localhost:5173
npm run build && npm start
```

## Tests

```bash
npm test                           # unit (Vitest)
npm run test:e2e                   # Playwright against the configured base URL
npm run regression:live            # unit + API smoke + full Playwright
npm run docs:shots                 # regenerate docs/images theme gallery
```

### Base URL for browser tests

Playwright defaults to **http://127.0.0.1:5173** (a local `npm run dev` or `npm start`).

To hit another host (for example a FreeBSD package install on your LAN):

```bash
export MDWEB_BASE_URL=http://192.0.2.10:5173
# or
export MDWEB_FREEBSD_HOST=192.0.2.10   # implies http://HOST:5173 for some scripts
npm run test:e2e
npm run docs:shots
```

Do not commit machine-specific IPs into the README or end-user docs.

## Layout of interest to developers

| Path | Role |
|------|------|
| `src/` | React UI |
| `server/` | Express API, themes, posts helpers |
| `server/posts/` | Sample / demo Markdown (seeded missing-only into runtime postsDir) |
| `server/themes/` | Shipped theme JSON |
| `e2e/` | Playwright specs |
| `docs/images/` | Generated marketing screenshots |
| `ports/www/mdweb/` | FreeBSD port |
| `scripts/deploy-live.sh` | Maintainer helper to push a tree to a test host |

## Auth modes while developing

Default is JWT. Session cookie mode: Admin → Security, or `MDWEB_AUTH_MODE=session`. See [AUTH.md](./AUTH.md).

## License

MIT — see [LICENSE](../LICENSE).

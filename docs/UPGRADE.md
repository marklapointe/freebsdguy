# MDWeb upgrade path (FreeBSD)

How to upgrade without losing posts, users, site settings, or theme customizations.

## Durable vs replaceable

| Path | Purpose | On upgrade |
|------|---------|------------|
| `/usr/local/www/mdweb` | App code, `dist/`, shipped themes | **Replaced** |
| `/usr/local/etc/mdweb/config.json` | Site settings, theme pack, AI, appearance | **Preserved** |
| `/usr/local/etc/mdweb/users.json` | Admin + users | **Preserved** |
| `/usr/local/etc/mdweb.env` | `JWT_SECRET` | **Preserved** |
| `/var/db/mdweb/posts` | Markdown posts + images | **Preserved** |
| `/var/db/mdweb/themes` | Runtime theme packs (incl. color overrides) | **Preserved** (missing files seeded only) |
| `/var/db/mdweb/sessions` | Classical session files (`authMode: session`) | **Preserved** (delete = force re-login) |
| `/var/run/mdweb` | pidfile | Runtime only |
| `/var/backups/mdweb` | Config snapshots from `deploy-live.sh` | Accumulates |

Auth mode (`security.authMode`) lives in `config.json` and survives deploy. See [AUTH.md](./AUTH.md).

Process must run with `CONFIG_DIR=/usr/local/etc/mdweb` (set by `rc.d/mdweb` and `deploy-live.sh`).

Sample config points data at absolute durable paths:

```json
"postsDir": "/var/db/mdweb/posts",
"themeDir": "/var/db/mdweb/themes"
```

## Operator upgrade steps

1. **Backup** (recommended):

   ```sh
   tar -C / -czf /root/mdweb-backup-$(date +%Y%m%d).tgz \
     usr/local/etc/mdweb usr/local/etc/mdweb.env var/db/mdweb
   ```

2. **Install** new package **or** run agent deploy:

   ```sh
   # package
   pkg install -y ./mdweb-*.pkg

   # or live tree deploy from the repo
   bash scripts/deploy-live.sh
   ```

3. **Do not** hand-copy theme JSON with `cp -f` into `/var/db/mdweb/themes` — that wipes Appearance color overrides. The service seeds **missing** theme files only.

4. **Restart** if the install did not:

   ```sh
   service mdweb restart
   # or deploy-live.sh hard-restart path
   ```

5. **Verify**:

   ```sh
   curl -sS http://127.0.0.1:5173/api/health
   curl -sS http://127.0.0.1:5173/api/config | head
   # siteName / currentTheme should match pre-upgrade
   ls /var/db/mdweb/posts
   ```

## Bad config: process must survive

If `config.json` is empty or invalid JSON:

1. The service **does not exit** (except insecure/missing JWT in production).
2. The bad file is moved to `config.json.bad-<timestamp>`.
3. Platform defaults are used (FreeBSD: posts/themes under `/var/db/mdweb`).
4. Logs under `/tmp/mdweb.out` (or service log) include `[ERROR] Invalid JSON…`.
5. Posts on disk remain under `/var/db/mdweb/posts`.

**Restore:**

```sh
# inspect
ls -la /usr/local/etc/mdweb/config.json.bad-*
# merge / fix JSON, then:
cp /usr/local/etc/mdweb/config.json.bad-YYYY… /usr/local/etc/mdweb/config.json
chown www:www /usr/local/etc/mdweb/config.json
chmod 0640 /usr/local/etc/mdweb/config.json
service mdweb restart
```

Same pattern for `users.json`.

Partial JSON (valid but wrong types) is **sanitized** in memory: bad fields drop to defaults; good fields (siteName, theme, AI key, etc.) are kept. Admin “Save” rewrites a clean document.

## Deploy script contract (`scripts/deploy-live.sh`)

- **May replace:** `/usr/local/www/mdweb/dist`, `server/`, `rc.d/mdweb`
- **Must not replace:** `config.json`, `users.json`, posts, existing theme JSON under `/var/db/mdweb/themes`
- **Must:** seed missing themes, fix ownership for `www`, optional config backup under `/var/backups/mdweb`

## Repeatable checks

```sh
# Maintainer checks (see docs/DEVELOPMENT.md) — not required for operators
npm test
npm run regression:live   # expects a running instance; set MDWEB_BASE_URL if not localhost
```

# MDWeb

**A personal website and blog that stores everything as files.**  
Markdown for posts. JSON for settings and themes. **No database.**

You write. You own the files. You run it on your machine — FreeBSD preferred, Node anywhere.

---

## Why this exists

Most “simple” blogs still want Postgres, a cloud account, or a proprietary export. MDWeb does not.

- **Posts are `.md` files** — edit in vim, VS Code, or the built-in admin editor  
- **Config and users are JSON** — readable, greppable, backup with `tar` or ZFS  
- **Themes are JSON color packs** — dozens of skins (CRT, Miami, Win95, Matrix, …), each with light and dark  
- **No MySQL, Postgres, SQLite, or Redis required** for day-to-day operation  

If you can copy a folder, you can move your site.

---

## Screenshots

![Home](docs/images/home-hero.png)

| A Markdown post | Theme picker (admin) |
|-----------------|----------------------|
| ![Post](docs/images/post-kitchen-sink.png) | ![Appearance](docs/images/admin-appearance.png) |

Every shipped theme in light and dark: **[docs/THEMES.md](docs/THEMES.md)**

| Miami Cyberpunk | Matrix | CRT Amber |
|-----------------|--------|-----------|
| ![](docs/images/themes/miami-cyberpunk-dark.png) | ![](docs/images/themes/matrix-dark.png) | ![](docs/images/themes/crt-amber-dark.png) |

---

## What you need

| Install path | Requirements |
|--------------|----------------|
| **FreeBSD package / port** | FreeBSD host, Node (pulled in by the port), a strong secret for login tokens |
| **From source** | Node.js 18+, npm |

That is it. No separate database server to install or tune.

---

## Install on FreeBSD (recommended)

1. Install the `www/mdweb` package or build the port under `ports/www/mdweb/`.  
2. Create a strong JWT secret in a file (required in production). The file must be mode `0600`. The secret is not passed on the command line:

   ```sh
   sudo umask 077
   openssl rand -hex 32 | sudo tee /usr/local/etc/mdweb/jwt.secret >/dev/null
   sudo chown www:www /usr/local/etc/mdweb/jwt.secret
   sudo chmod 0600 /usr/local/etc/mdweb/jwt.secret
   ```

   The rc script exports `JWT_SECRET_FILE` (the path only). A mode other than `0600` refuses to start.

3. Create the admin account. There is no `admin` / `admin` login. Use a one-time setup token or stdin (the password is never an argument):

   ```sh
   cd /usr/local/www/mdweb
   sudo -u www env CONFIG_DIR=/usr/local/etc/mdweb \
     ./node_modules/.bin/tsx server/scripts/bootstrap-admin.ts --issue-token
   # paste the token once:
   printf '%s\n' 'a-long-password' | sudo -u www env CONFIG_DIR=/usr/local/etc/mdweb \
     ./node_modules/.bin/tsx server/scripts/bootstrap-admin.ts \
     --username admin --setup-token 'THE_TOKEN'
   ```

   Or, on the jail console, `--stdin` and a password on standard input. Later changes:

   ```sh
   printf '%s\n' 'a-new-password' | sudo -u www env CONFIG_DIR=/usr/local/etc/mdweb \
     ./node_modules/.bin/tsx server/scripts/change-password.ts admin
   ```

4. Enable and start the service. It listens on `service.host` from `config.json` (default `127.0.0.1`):

   ```sh
   sudo sysrc mdweb_enable=YES
   sudo service mdweb start
   ```

5. Open the site at `http://127.0.0.1:5173` on the jail, or set `service.host` if you intentionally bind a wider address. Put TLS and a public hostname on a reverse proxy.

### Where your data lives (package install)

| Path | What |
|------|------|
| `/usr/local/etc/mdweb/config.json` | Site name, theme, bind host, CORS allowlist, rate limits |
| `/usr/local/etc/mdweb/users.json` | Accounts (password hashes) |
| `/usr/local/etc/mdweb/jwt.secret` | JWT signing secret (mode `0600`) |
| `/usr/local/etc/mdweb/audit.log` | JSON-lines audit log (or `AUDIT_LOG_PATH`) |
| `/var/db/mdweb/posts/` | **Your Markdown posts and images** |
| `/var/db/mdweb/themes/` | Theme files (including any color tweaks you save) |

Upgrades replace the app under `/usr/local/www/mdweb`. They do **not** wipe posts or config when installed correctly. Details: [docs/UPGRADE.md](docs/UPGRADE.md).

---

## Install from source (any OS with Node)

```bash
git clone <this-repo>
cd mdweb   # or freebsdguy, depending on your checkout
npm install
npm run dev
```

Open **http://127.0.0.1:5173** after you create an admin (there is no default `admin` / `admin` password):

```bash
npm run bootstrap-admin -- --stdin
# type a password on stdin, or: printf '%s\n' 'a-long-password' | npm run bootstrap-admin -- --stdin
```

Production-style run. The secret file must be mode `0600`:

```bash
umask 077
openssl rand -hex 32 > "$PWD/jwt.secret"
chmod 0600 jwt.secret
export JWT_SECRET_FILE="$PWD/jwt.secret"
npm run build
npm start
```

Posts in development are ordinary Markdown files under `server/posts/`.

---

## Sortable tables (optional)

Readers can sort a post's tables by clicking a column header (click again to reverse). Numbers sort as numbers. Without JavaScript, tables show in the order you wrote them. Sorting is **off by default**. Three switches turn it on or off; the most specific one wins:

1. **Whole site**: in `config.json`, set `"tableSort": true` (default `false`).
2. **One post**: in the post's front matter, add `tablesort: true` or `tablesort: false`. This overrides the site setting.
3. **One table**: put an empty element with `data-mdweb-sort` right before the table. This overrides the site and post settings:

   ```markdown
   <p data-mdweb-sort="off"></p>

   | Name | Size |
   |---|---|
   | a | 1 |
   ```

   Use `"on"` to make one table sortable in a post that is otherwise off.

How cells sort: numbers sort as numbers, including token counts like `128K` (x1,024), `262,144` and `1M` (x1,048,576); the first standalone number in a cell is used (`5 at 128K` sorts as 5, `max 128K` as 131072; signs are ignored). In a column with numbers, cells with no number, such as `Queued`, `n/a` or `Not supported`, always go last; an all-text column sorts alphabetically. To control a cell's order yourself, give it (or an element inside it) a `data-sort` value, e.g. `<span data-sort="131072"></span>128K`.

Accepted values, the same at all three levels: `true`/`false`, `on`/`off`, `yes`/`no`, `1`/`0`. Anything else is ignored (the next setting down applies); the site config also logs a warning. The empty marker paragraph renders as a small gap above the table.

## Badges

Coloured labels on table cells. **The renderer never hardcodes a value list.** Mark which columns should badge; the theme CSS colours each slug.

### Mark a column (declarative)

Put an empty element with `data-mdweb-badge` right before the table (same pattern as sortable tables), or on a CSV placeholder link:

```html
<p data-mdweb-badge="Engine"></p>

| Model | Engine | Setup |
| --- | --- | --- |
| Ornith | vLLM | Single Node |
```

```html
<a href="/api/getimage?fileName=results.csv" title="mdweb-csv-table" data-mdweb-badge="Engine">Results</a>
```

- Comma-separated header names: `data-mdweb-badge="Engine,Status"`.
- Add `:sort` on a column to set `data-sort` from the cell (so `128K` sorts as 131072): `data-mdweb-badge="Limit:sort"`.
- Cells that are empty, `NA`, `—`, `–`, or `-` stay plain text.
- A plain-text cell becomes `<span class="mdweb-badge" data-badge="<slug>">…</span>`, where the slug is the cell text lowercased with non-alphanumerics removed (`vLLM` → `vllm`, `llama.cpp` → `llamacpp`, `128K` → `128k`). Cells that already contain a link or other markup are left alone.
- **Breaking for older posts:** auto-badging of known engine names without a marker is gone. Add `data-mdweb-badge="Engine"` (or write the span by hand) when you republish.

You can still write a badge by hand (add `data-sort` so sortable tables order by value):

```html
<span class="mdweb-badge" data-badge="vllm">vLLM</span>
<span class="mdweb-badge" data-badge="128k" data-sort="131072">128K</span>
```

### Colours (theme only)

Add or change a colour in `src/index.css` with one rule. Unknown slugs keep the grey fallback. Shipped pairs (each ≥ 4.5:1 text contrast):

| `data-badge` | Typical use |
|---|---|
| `vllm`, `sglang`, `llamacpp`, `tensorfold`, `tandemllm`, `ollama` | engines |
| `32k`, `64k`, `128k`, `256k`, `512k`, `1m` (and legacy `ctx-*`) | context sizes |


## Renaming a post (redirects)

To rename a post, rename its file (the file name is the slug) and list the old slug in the new file's front matter:

```yaml
aliases:
  - old-slug
```

Then `/post/old-slug` and `/api/posts/old-slug` answer a permanent redirect (301) to the new slug, keeping any query string. Browsers cache a 301, so only alias a slug you will not reuse. A real post with the old slug always wins over an alias. Aliases must be plain slugs (letters, digits, `-`, `_`).

## Day-to-day use

| Task | How |
|------|-----|
| Write a post | Log in → Admin → New Post, or drop a `.md` file into the posts directory |
| Change site look | Admin → **Appearance** → pick a theme → Set as site theme |
| Light / dark | Anyone: sun/moon control in the navbar (applies to the current theme pack) |
| Site name, home list, copyright | Admin → **Site** — posts per page, sort, search placement, footer text (or hide/clear copyright) |
| Users | Admin → Users (admin only) — create or delete accounts |
| Auth style | Admin → **Security** — JWT (default) or classical session cookies; see [docs/AUTH.md](docs/AUTH.md) |
| MCP / API tokens | Admin → **Tokens** — mint a `mdw_…` PAT with scope `read` or `write`; see [docs/MCP.md](docs/MCP.md) |

Showcase posts (math, code, Mermaid, kitchen-sink Markdown) can appear on first install; they are only copied if those files are not already present, so your writing is never overwritten. Markdown notes: [docs/MARKDOWN.md](docs/MARKDOWN.md).

---

## Documentation

| Doc | Audience |
|-----|----------|
| [docs/ADMIN.md](docs/ADMIN.md) | Running the admin UI |
| [docs/AUTH.md](docs/AUTH.md) | JWT vs session login |
| [docs/MCP.md](docs/MCP.md) | Streamable HTTP MCP + personal access tokens |
| [docs/UPGRADE.md](docs/UPGRADE.md) | Backups, upgrades, durable paths |
| [docs/MARKDOWN.md](docs/MARKDOWN.md) | What works in posts |
| [docs/THEMES.md](docs/THEMES.md) | Full theme gallery |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Building from source, tests, contributing |

---

## License

**MIT License**  
Copyright (c) 2026 Mark LaPointe  

Free to use, modify, and distribute, subject to the terms in [LICENSE](./LICENSE). Provided as-is, without warranty.

## Flatpak (Linux)

A self-contained bundle (Node 22 LTS + built app) is produced by:

```sh
scripts/build-flatpak.sh            # → artifacts/flatpak/org.cloudbsd.MDWeb-<version>.flatpak
flatpak install --user artifacts/flatpak/org.cloudbsd.MDWeb-1.1.0.flatpak
flatpak run org.cloudbsd.MDWeb      # http://localhost:5173
flatpak run --env=PORT=8080 org.cloudbsd.MDWeb
```

Requires only `flatpak` and `org.freedesktop.Platform//25.08` (no flatpak-builder).
Data (config.json, users.json, posts/, themes/, generated `mdweb.env`) lives in
`~/.var/app/org.cloudbsd.MDWeb/data/mdweb`.

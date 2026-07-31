# Admin guide

## Roles

| Role | Can |
|------|-----|
| **admin** | Site, Appearance, Security, Users, AI, posts, images |
| **contributor** | Posts and images only |

## Site (was “Settings”)

| Section | What you control |
|---------|------------------|
| **Identity** | Site name, logo |
| **Home page** | Posts per page, sort field/order, search box placement (top / bottom / hidden) |
| **Footer & copyright** | Show/hide footer, copyright line (`{year}`, `{siteName}`), clear or reset, optional credit line |
| **Service** | Listen port (restart required after change) |
| **Advanced paths** | Posts directory, themes directory (be careful) |

Save with **Save site settings**.

## Appearance

- Theme pack (site-wide)
- Default light/dark for visitors who have not chosen
- CRT effects / text glow
- Color overrides per pack

## Security

- Auth mode: JWT (default) or session cookie — [AUTH.md](./AUTH.md)
- Session lifetime and cookie name (session mode)
- Disable public search, image uploads, or AI

## AI

Provider, base URL, model, API key (never returned in public config).

## Users

Create contributor/admin accounts (password min 8 characters). Delete any user except yourself.

## Data paths (package)

| What | Where |
|------|--------|
| Config / users | `/usr/local/etc/mdweb` |
| Posts / themes / sessions | `/var/db/mdweb` |

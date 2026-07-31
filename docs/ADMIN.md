# Admin guide

## Roles

| Role | Can |
|------|-----|
| **admin** | Settings, Appearance, Security, Users, AI, posts, images |
| **contributor** | Posts and images only |

## Appearance

- **Theme pack** — site-wide; visitors do not pick the pack  
- **Default light/dark** — used until a visitor toggles mode  
- **CRT effects / text glow** — retro packs only  
- Color overrides save into `/var/db/mdweb/themes/<id>.json` (durable; deploy seeds *missing* packs only)

## Security

- **Auth mode**: JWT (default) or session cookie — see [AUTH.md](./AUTH.md)  
- Feature kills: public search, image uploads, AI  

## AI

Configure provider, base URL, model. API keys never appear in public `/api/config`.

## Data paths (package)

| What | Where |
|------|--------|
| Config / users | `/usr/local/etc/mdweb` |
| Posts / themes / sessions | `/var/db/mdweb` |

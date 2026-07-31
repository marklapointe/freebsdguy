# Authentication (JWT or session)

MDWeb prefers **JWT Bearer** tokens. You can switch to **classical session cookies** when JWT is painful in your environment.

## Modes

| Mode | Client | Server |
|------|--------|--------|
| `jwt` (default) | `Authorization: Bearer <token>` in localStorage | `jwt.verify` |
| `session` | HttpOnly cookie `mdweb.sid` | File store under `/var/db/mdweb/sessions` |

Exclusive modes (v1): one or the other, not both.

## When to use session mode

- Reverse proxy / WAF strips `Authorization`
- Clock skew breaks JWT `exp`
- Secret rotation forces constant re-login friction
- Clients cannot keep Bearer headers reliably

## How to switch

1. **Admin → Security** → Authentication mode → *Session cookie* → Save  
2. Or set in `config.json`:

```json
"security": { "authMode": "session", "sessionTtlSeconds": 86400 }
```

3. Or process env (wins over config):

```sh
MDWEB_AUTH_MODE=session
```

Everyone must log in again after a mode change.

## Secrets

Production still needs a strong secret for **either** mode:

- `JWT_SECRET` in `/usr/local/etc/mdweb.env` (recommended)
- or `SESSION_SECRET` (used when set; falls back to `JWT_SECRET`)
- or `config.jwtSecret` (discouraged for production)

Default insecure value is rejected in production.

## Logout

`POST /api/logout` clears the session cookie (session mode) and is safe to call in JWT mode (client still clears localStorage).

## CSRF note

Session cookies use `SameSite=Lax` and assume a same-origin SPA. Cross-site cookie POSTs are out of scope for v1.

See also: [UPGRADE.md](./UPGRADE.md), [ADMIN.md](./ADMIN.md).

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

Production reads the signing secret from a file, not from the command line:

- `JWT_SECRET_FILE` (default in the rc script: `/usr/local/etc/mdweb/jwt.secret`)
- the file must be mode `0600` or the process refuses to start
- `SESSION_SECRET` or `JWT_SECRET` in the environment still work for development
- `config.jwtSecret` is discouraged

The known insecure value is rejected in production. The rc script exports only the file path.

## First admin

MDWeb does not ship `admin` / `admin`. If that password hash is present, startup is refused and login returns 403.

Create the account with `bootstrap-admin` (one-time setup token, or stdin on the console). `change-password` reads the new password from stdin or `--password-file` (also mode `0600`). It will not take the password as an argument.

## Logout

`POST /api/logout` clears the session cookie (session mode) and is safe to call in JWT mode (client still clears localStorage).

## CSRF note

Session cookies use `SameSite=Lax` and assume a same-origin SPA. Cross-site cookie POSTs are out of scope for v1.

## Personal access tokens (MCP / API)

Long-lived `mdw_…` Bearer tokens can be minted in Admin → **Tokens** (or `POST /api/tokens`). Each token has a scope, `read` or `write`, stored next to its hash in `tokens.json`. The default scope is **read**. Write is stored only when it is requested explicitly. A read token's MCP tools are an allowlist (`health`, posts, images, themes, playbook). Details: [MCP.md](./MCP.md).

`security.trustProxy` defaults to `loopback`. A client that connects directly (for example on a WireGuard address) cannot change its rate-limit identity with `X-Forwarded-For`. Set `trustProxy` to a hop count or `true` only behind a reverse proxy you control. `service.host` accepts IPv4 and IPv6 literals.

See also: [UPGRADE.md](./UPGRADE.md), [ADMIN.md](./ADMIN.md), [MCP.md](./MCP.md).

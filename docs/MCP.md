# MDWeb MCP

MDWeb exposes a **Streamable HTTP** MCP endpoint on the same process as the site:

```text
POST https://YOUR-HOST:5173/mcp
Authorization: Bearer mdw_…
```

Every MCP call requires a **personal access token (PAT)**. The token acts as the owning user: contributors manage posts and images; admins also manage config, themes, users, and tokens.

## Mint a token

1. Sign in as admin → **Tokens**
2. Choose the user, optional label → **Generate**
3. Copy the secret once (it is never shown again)
4. Or: contributor **Posts → My API tokens** for own tokens only

REST equivalents: `POST /api/tokens`, `POST /api/admin/tokens`, `GET /api/tokens`, `DELETE /api/tokens/:id`.

Plaintext is returned only at mint. Disk stores SHA-256 hashes in `tokens.json` next to `users.json` (`CONFIG_DIR` / `/usr/local/etc/mdweb/tokens.json` on FreeBSD packages), plus a `scope` of `read` or `write`.

Mint from the CLI (scope is required). `npm run` prints its own banner lines on stdout, and those lines would land in the token file, so use the silent form:

```sh
npm run --silent mint-token -- --username admin --label cursor --scope read
# the direct form prints no banner at all:
npx tsx server/scripts/mint-token.ts --username admin --label cursor --scope read
```

New tokens default to **read**. Pass `--scope write` (or choose write in the admin UI) to mint a token that can change the site. A record without an explicit `"scope": "write"` is read.

A read token may call only `get_playbook`, `health`, `list_posts`, `get_post`, `list_images`, and `list_themes`. Every other tool — including `list_users`, `list_tokens`, `get_config`, `ai_list_models`, and any tool added later — is refused. HTTP create, edit, and delete routes also return 403.

## Agent accounts (no password)

An AI agent account has **no password** and can never sign in on the web: it exists for one personal access token. Create it from the CLI:

```sh
npm run --silent create-agent-user -- --username ampere-mcp --scope read,content:write
# the direct form prints no banner at all:
npx tsx server/scripts/create-agent-user.ts --username ampere-mcp --scope read,content:write
```

The token is printed on stdout and nothing else, and only when stdout is a pipe, so it can go straight into a secret store. The CLI refuses to run when `users.json` is missing or broken: it never creates a default admin and never quarantines the file.

## Cursor / HTTP client config

Example (adjust URL and token):

```json
{
  "mcpServers": {
    "mdweb": {
      "url": "http://127.0.0.1:5173/mcp",
      "headers": {
        "Authorization": "Bearer mdw_YOUR_TOKEN_HERE"
      }
    }
  }
}
```

Put the PAT in client config or an env var the client expands — **not** in chat tool arguments.

## Role matrix (tools)

| Capability | Contributor | Admin |
|------------|:-----------:|:-----:|
| Posts / images / AI (if enabled) | yes | yes |
| Config, themes, users | no | yes |
| List/create/revoke own tokens | yes | yes |
| Mint/revoke tokens for any user | no | yes |
| `health`, `get_playbook` | yes | yes |

Call `get_playbook` (or read resource `mdweb://playbook`) for workflows.

## Security notes

- A PAT is as powerful as that user’s password for API/MCP — rotate by revoking in Admin.
- Deleting a user revokes their PATs. Password change does **not** auto-revoke PATs.
- Max 20 active tokens per user.
- Prefer loopback (`service.host` defaults to `127.0.0.1`) or TLS (`MDWEB_TLS=1` behind a reverse proxy).
- CORS is an allowlist (`security.corsOrigins` or `MDWEB_CORS_ORIGINS`). `*` is ignored and is never combined with credentials.
- `/mcp`, `/api`, and `POST /api/login` are rate limited. Excess requests get HTTP 429. Tune `security.mcpRateLimitMax`, `apiRateLimitMax`, and `loginRateLimitMax` (windows are in seconds).

See also [AUTH.md](./AUTH.md).

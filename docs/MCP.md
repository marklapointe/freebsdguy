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

Plaintext is returned only at mint. Disk stores SHA-256 hashes in `tokens.json` next to `users.json` (`CONFIG_DIR` / `/usr/local/etc/mdweb/tokens.json` on FreeBSD packages).

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
- Prefer loopback or TLS (`MDWEB_TLS=1` behind a reverse proxy) when the host is reachable beyond localhost.

See also [AUTH.md](./AUTH.md).

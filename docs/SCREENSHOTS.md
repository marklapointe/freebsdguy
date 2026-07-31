# Documentation screenshots

## Regenerate

Maintainer / contributor tooling (not needed to run a blog).

```bash
# App must already be running (e.g. npm run dev or npm start)
npm run docs:shots

# Remote package install on your LAN:
MDWEB_BASE_URL=http://YOUR-HOST:5173 npm run docs:shots
```

## Requirements

- Capture **every** theme from `GET /api/themes`
- For each theme: **dark** and **light** stills  
  - `docs/images/themes/<id>-dark.png`  
  - `docs/images/themes/<id>-light.png`
- Count must match catalog length × 2
- Restore site theme to `dark` when finished

## Product chrome

Also writes:

- `docs/images/home-hero.png`
- `docs/images/post-kitchen-sink.png`
- `docs/images/admin-appearance.png`
- `docs/images/admin-security.png` (if Security UI present)

## Gallery index

`docs/images/themes/INDEX.md` and `docs/THEMES.md` list all packs.

Not part of default `regression-round.sh smoke` (too slow). Run before releases when UI/themes change.

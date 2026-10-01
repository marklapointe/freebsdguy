#!/bin/sh
# MDWeb flatpak entrypoint. Data lives in the sandbox's XDG data dir:
#   ~/.var/app/org.cloudbsd.MDWeb/data/mdweb  (config.json, users.json, posts/, themes/, mdweb.env)
set -e
: "${MDWEB_HOME:=${XDG_DATA_HOME:-$HOME/.local/share}/mdweb}"
mkdir -p "$MDWEB_HOME/posts/images" "$MDWEB_HOME/themes"

export NODE_ENV=production
export CONFIG_DIR="$MDWEB_HOME"
# config.service.port (default 5173) outranks the PORT env var inside the server, so an
# explicit PORT from `flatpak run --env=PORT=...` is forwarded as the CLI override.
PORT_ARGS=""
[ -n "${PORT:-}" ] && PORT_ARGS="-p ${PORT}"

# Auth secret: honour JWT_SECRET/SESSION_SECRET from the environment, else persist a generated one
if [ -z "${JWT_SECRET:-}" ] && [ -z "${SESSION_SECRET:-}" ]; then
    if [ ! -f "$MDWEB_HOME/mdweb.env" ]; then
        umask 077
        printf 'JWT_SECRET=%s\n' "$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')" > "$MDWEB_HOME/mdweb.env"
    fi
    . "$MDWEB_HOME/mdweb.env"
    export JWT_SECRET
fi

cd /app/share/mdweb
# shellcheck disable=SC2086
exec /app/lib/node/bin/node ./node_modules/.bin/tsx server/index.ts ${PORT_ARGS} "$@"

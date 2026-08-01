#!/bin/sh
# Generate pkg-plist from a FreeBSD ports stage directory.
# Usage: gen-plist.sh /usr/ports/www/mdweb
set -eu
PORTDIR="${1:-.}"
STAGE_ROOT="${PORTDIR}/work/stage"
STAGE="${STAGE_ROOT}/usr/local"
OUT="${PORTDIR}/pkg-plist"

if [ ! -d "${STAGE}/www/mdweb" ]; then
  echo "No stage at ${STAGE}/www/mdweb — run: make stage" >&2
  exit 1
fi

{
  find "${STAGE}/www/mdweb" \( -type f -o -type l \) \
    | sed "s|^${STAGE}/||" | sort
  find "${STAGE}/share/man" -type f 2>/dev/null \
    | sed "s|^${STAGE}/||" | sort
  # Runtime data shipped into the package (theme catalog, welcome post)
  find "${STAGE_ROOT}/var/db/mdweb" \( -type f -o -type l \) 2>/dev/null \
    | sed "s|^${STAGE_ROOT}/|/|" | sort
  # USE_RC_SUBR already packs etc/rc.d/mdweb — do not list it again.
  # @sample: path is the .sample file under PREFIX; installs to basename without .sample
  echo "@sample etc/mdweb/config.json.sample"
  echo "@sample etc/mdweb/users.json.sample"
  echo "@sample etc/mdweb/mdweb.env.sample"
  echo "@dir /var/db/mdweb"
  echo "@dir /var/db/mdweb/posts"
  echo "@dir /var/db/mdweb/posts/images"
  echo "@dir /var/db/mdweb/themes"
} | awk 'NF && !seen[$0]++' > "${OUT}"

echo "Wrote ${OUT} ($(wc -l < "${OUT}") lines)"

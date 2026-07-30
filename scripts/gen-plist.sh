#!/bin/sh
# Generate pkg-plist from a FreeBSD ports stage directory.
# Usage: gen-plist.sh /usr/ports/www/mdweb
set -eu
PORTDIR="${1:-.}"
STAGE="${PORTDIR}/work/stage/usr/local"
OUT="${PORTDIR}/pkg-plist"
{
  find "${STAGE}/www/mdweb" \( -type f -o -type l \) 2>/dev/null \
    | sed "s|^${STAGE}/||" | sort
  find "${STAGE}/share/man" -type f 2>/dev/null \
    | sed "s|^${STAGE}/||" | sort
  echo "etc/rc.d/mdweb"
  echo "@sample etc/mdweb/config.json.sample"
  echo "@sample etc/mdweb/users.json.sample"
  echo "@sample etc/mdweb/mdweb.env.sample"
  echo "@dir /var/db/mdweb"
  echo "@dir /var/db/mdweb/posts"
  echo "@dir /var/db/mdweb/posts/images"
  echo "@dir /var/db/mdweb/themes"
} | awk 'NF && !seen[$0]++' > "${OUT}"
echo "Wrote ${OUT} ($(wc -l < "${OUT}") lines)"

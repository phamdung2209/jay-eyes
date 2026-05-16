#!/bin/sh
# Wrapper entrypoint for Jay Eyes SearXNG on Render.
#
# The upstream entrypoint refuses to boot if settings.yml still contains
# the literal "ultrasecretkey". We can't bake the real secret into the
# image (it would end up in git), so instead:
#   1. Read $SEARXNG_SECRET (set as a Render env var, sync: false).
#   2. Substitute it into settings.yml in place using # as sed delimiter
#      so a / inside the secret never trips it.
#   3. Hand off to the upstream entrypoint, which then starts Granian.
#
# Fall back to generating an ephemeral key if SEARXNG_SECRET is missing
# (keeps the container bootable for local docker test; production
# Render deploy MUST set the secret).
set -eu

SETTINGS_FILE="${__SEARXNG_SETTINGS_PATH:-/etc/searxng/settings.yml}"

if [ -f "$SETTINGS_FILE" ] && grep -q "ultrasecretkey" "$SETTINGS_FILE"; then
    if [ -n "${SEARXNG_SECRET:-}" ]; then
        SECRET_VALUE="$SEARXNG_SECRET"
    else
        SECRET_VALUE=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 48)
        echo "[entrypoint] SEARXNG_SECRET not set; generated ephemeral key" >&2
    fi
    sed -i "s#ultrasecretkey#${SECRET_VALUE}#g" "$SETTINGS_FILE"
fi

exec /usr/local/searxng/entrypoint.sh "$@"

#!/bin/sh
set -e

SETTINGS_FILE="${__SEARXNG_SETTINGS_PATH:-/etc/searxng/settings.yml}"

if [ -f "$SETTINGS_FILE" ] && grep -q "ultrasecretkey" "$SETTINGS_FILE"; then
    if [ -n "$SEARXNG_SECRET" ]; then
        sed -i "s|ultrasecretkey|$SEARXNG_SECRET|g" "$SETTINGS_FILE"
    else
        GEN=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 48)
        sed -i "s|ultrasecretkey|$GEN|g" "$SETTINGS_FILE"
        echo "[entrypoint] SEARXNG_SECRET not set; generated ephemeral key" >&2
    fi
fi

exec /usr/local/searxng/entrypoint.sh

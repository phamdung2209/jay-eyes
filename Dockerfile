FROM searxng/searxng:latest

USER root

# Drop our settings + limiter on top of upstream defaults. SearXNG honours
# `use_default_settings: true` so we only ship the overrides; new engines /
# upstream security fixes ride the image bump for free.
COPY settings.yml /etc/searxng/settings.yml
COPY limiter.toml /etc/searxng/limiter.toml

# Wrapper entrypoint substitutes $SEARXNG_SECRET into settings.yml then
# hands off to the upstream entrypoint. /usr/local/searxng/ is the only
# guaranteed-writable dir in the upstream image (/usr/local/bin doesn't exist).
COPY entrypoint.sh /usr/local/searxng/jay-eyes-entrypoint.sh

RUN set -eux; \
    mkdir -p /etc/searxng /var/cache/searxng /var/log/searxng; \
    chmod -R 0777 /etc/searxng /var/cache/searxng /var/log/searxng; \
    chmod 0666 /etc/searxng/settings.yml /etc/searxng/limiter.toml; \
    sed -i 's/\r$//' /usr/local/searxng/jay-eyes-entrypoint.sh; \
    chmod 0755 /usr/local/searxng/jay-eyes-entrypoint.sh

ENV SEARXNG_PORT=8080 \
    SEARXNG_BIND_ADDRESS=0.0.0.0 \
    SEARXNG_SETTINGS_PATH=/etc/searxng/settings.yml \
    INSTANCE_NAME="Jay Eyes" \
    AUTOCOMPLETE=duckduckgo \
    FORCE_OWNERSHIP=false

EXPOSE 8080

ENTRYPOINT ["/bin/sh", "/usr/local/searxng/jay-eyes-entrypoint.sh"]

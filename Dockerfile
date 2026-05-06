FROM searxng/searxng:latest

COPY settings.yml /etc/searxng/settings.yml
COPY entrypoint.sh /custom-entrypoint.sh

USER root
RUN chmod +x /custom-entrypoint.sh

ENV INSTANCE_NAME="Jay Eyes" \
    AUTOCOMPLETE=duckduckgo

EXPOSE 8080

ENTRYPOINT ["/custom-entrypoint.sh"]

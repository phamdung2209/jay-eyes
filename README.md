# jay-eyes

Self-hosted [SearXNG](https://github.com/searxng/searxng) instance — the eyes of [Jay](https://huggingface.co/spaces/jay-hank/Jay) on the web.

Deployed on Render.com (free tier). Jay's openclaw gateway calls this instance for web search.

## Files

- `Dockerfile` — extends `searxng/searxng:latest`, mounts custom settings + entrypoint wrapper
- `entrypoint.sh` — substitutes `ultrasecretkey` placeholder with `$SEARXNG_SECRET` env (or generates an ephemeral key) before delegating to the image's official entrypoint
- `settings.yml` — tuned for Jay: EN default lang, per-engine timeouts, social-SEO honeypots blocked, JSON output enabled
- `limiter.toml` — bot-detection rules; only used when `server.limiter: true` (off by default — Jay rate-limits upstream)
- `render.yaml` — Render Blueprint: free plan, Docker runtime, Singapore region

## Deploy on Render

1. Push this repo to GitHub
2. Render dashboard → **New** → **Blueprint** → connect this repo
3. Set env var `SEARXNG_SECRET` (any 32+ char random string) when prompted
4. Render builds and deploys automatically; the URL will be `https://jay-eyes-XXXX.onrender.com`

## Local test

```bash
docker build -t jay-eyes .
docker run --rm -p 8080:8080 -e SEARXNG_SECRET=test123456789 jay-eyes
curl 'http://localhost:8080/search?q=hello&format=json'
```

## Wire into Jay

In Jay's `openclaw.json`:

```json
"plugins": {
  "entries": {
    "searxng": {
      "enabled": true,
      "config": {
        "baseUrl": "https://jay-eyes-XXXX.onrender.com",
        "timeoutMs": 12000,
        "defaultCount": 5
      }
    }
  }
},
"tools": {
  "web": {
    "search": { "provider": "searxng" }
  }
}
```

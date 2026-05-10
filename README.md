# jay-discord-proxy (proxy branch)

Tiny HTTP CONNECT proxy that lets Jay (HF Space at `jay-hank/Jay`) reach
Discord through a network HF doesn't block. **Restricted to `*.discord.com` /
`*.discord.gg` / `*.discordapp.*` only — not an open proxy.**

## Why

HF Spaces block outbound to `discord.com` IPv4 ranges, so Jay's Discord
channel can't connect direct. Cloudflare Workers can't proxy the persistent
WebSocket gateway either. Render Web Service (Node runtime, free tier) sits
in between and tunnels the traffic.

## Architecture

```
HF Space (Jay)
  └─ channels.discord.proxy=https://jay-discord-proxy.onrender.com
        ├── HTTP CONNECT discord.com:443         → REST API
        └── HTTP CONNECT gateway.discord.gg:443  → WebSocket
                       │
                       ▼
              this Render service
                       │
                       ▼
                  discord.com
```

## Branch layout

- `main` — SearXNG instance (Jay Eyes search backend)
- `proxy` — this Discord HTTP CONNECT proxy

Each branch deploys to its own Render service.

## Deploy on Render

1. New → Web Service → connect this repo
2. Branch: `proxy`
3. Runtime: Node (auto-detected from `render.yaml`)
4. Plan: Free
5. Deploy → URL like `https://jay-discord-proxy.onrender.com`

## Use from Jay

In `openclaw.json`:

```json
{
  "channels": {
    "discord": {
      "enabled": true,
      "proxy": "https://jay-discord-proxy.onrender.com"
    }
  }
}
```

## Keep-warm

Render free tier sleeps after 15 minutes of inactivity. To keep the proxy
warm so Discord WebSocket doesn't disconnect, set up an UptimeRobot HTTPS
monitor pinging `/health` every 5 minutes.

## Security

The CONNECT handler refuses any host that doesn't match
`/^([a-z0-9-]+\.)*(discord\.com|discord\.gg|discordapp\.com|discordapp\.net)$/i`,
so even if the public URL leaks the worst an outsider can do is talk to
Discord's own infra (which they could already do directly).

## Local test

```bash
npm install
PORT=8080 npm start
# in another shell:
curl --proxy http://127.0.0.1:8080 https://discord.com/api/v10/gateway
# should return: {"url":"wss://gateway.discord.gg"}
```

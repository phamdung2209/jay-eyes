// jay-discord-proxy: Tiny HTTP CONNECT proxy for Jay's Discord channel.
// Restricted to *.discord.com / *.discord.gg / *.discordapp.* — not an open proxy.
// Deployed on Render (proxy branch) so HF Space can reach Discord through a
// network HF doesn't block.

const http = require('http');
const net = require('net');

const PORT = process.env.PORT || 8080;

// Only allow CONNECT to Discord-related hosts to prevent open-proxy abuse
const DISCORD_HOST_RE = /^([a-z0-9-]+\.)*(?:discord\.com|discord\.gg|discordapp\.com|discordapp\.net)$/i;

const server = http.createServer((req, res) => {
  // Health check — used by Render and UptimeRobot for keep-warm pings
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('jay-discord-proxy: alive\n');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found\n');
});

// HTTP CONNECT method — used by HTTP proxies for HTTPS/WebSocket tunneling.
// OpenClaw's Discord plugin opens a CONNECT to gateway.discord.gg:443 through here.
server.on('connect', (req, clientSocket, head) => {
  const [hostname, portStr] = req.url.split(':');
  const port = parseInt(portStr, 10) || 443;

  if (!DISCORD_HOST_RE.test(hostname)) {
    console.log(`[reject] ${hostname}:${port} — not a Discord host`);
    clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    clientSocket.destroy();
    return;
  }

  console.log(`[connect] ${hostname}:${port}`);
  const serverSocket = net.connect(port, hostname, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  const cleanup = (err) => {
    if (err) console.error(`[err] ${hostname}: ${err.message}`);
    serverSocket.destroy();
    clientSocket.destroy();
  };
  serverSocket.on('error', cleanup);
  clientSocket.on('error', cleanup);
  clientSocket.on('end', () => serverSocket.end());
  serverSocket.on('end', () => clientSocket.end());
});

server.listen(PORT, () => {
  console.log(`jay-discord-proxy listening on :${PORT}`);
});

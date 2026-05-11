import express from "express";
import { Client, GatewayIntentBits, Partials, Events } from "discord.js";

const {
  DISCORD_BOT_TOKEN,
  OPENCLAW_HOOK_URL,
  OPENCLAW_HOOK_TOKEN,
  CALLBACK_BASE_URL,
  ALLOWED_USER_IDS = "",
  ALLOWED_GUILD_IDS = "",
  REQUIRE_MENTION = "true",
  PORT = "3000",
} = process.env;

if (!DISCORD_BOT_TOKEN) throw new Error("Missing DISCORD_BOT_TOKEN");
if (!OPENCLAW_HOOK_URL) throw new Error("Missing OPENCLAW_HOOK_URL");
if (!OPENCLAW_HOOK_TOKEN) throw new Error("Missing OPENCLAW_HOOK_TOKEN");
if (!CALLBACK_BASE_URL) throw new Error("Missing CALLBACK_BASE_URL");

const allowedUsers = new Set(
  ALLOWED_USER_IDS.split(",").map((s) => s.trim()).filter(Boolean),
);
const allowedGuilds = new Set(
  ALLOWED_GUILD_IDS.split(",").map((s) => s.trim()).filter(Boolean),
);
const requireMention = REQUIRE_MENTION !== "false";

const pending = new Map();
const PENDING_TTL_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, ctx] of pending) {
    if (now - ctx.createdAt > PENDING_TTL_MS) pending.delete(key);
  }
}, 60_000);

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => res.status(200).send("Jay Discord Bridge OK"));

app.get("/health", (_req, res) =>
  res.status(200).json({
    ok: true,
    service: "jay-discord-bridge",
    uptime: process.uptime(),
    pending: pending.size,
  }),
);

app.post("/openclaw-callback", async (req, res) => {
  res.status(200).json({ ok: true });

  try {
    const payload = req.body || {};
    console.log("Callback received:", JSON.stringify(payload).slice(0, 800));

    const sessionKey = payload.sessionKey || payload.session_key;
    const reply = extractReply(payload);

    if (!sessionKey) {
      console.warn("Callback missing sessionKey");
      return;
    }
    if (!reply) {
      console.warn("Callback missing reply text for", sessionKey);
      return;
    }

    const ctx = pending.get(sessionKey);
    pending.delete(sessionKey);

    if (!ctx) {
      console.warn("No pending context for", sessionKey);
      return;
    }

    await sendDiscordReplyFromCtx(ctx, reply);
  } catch (err) {
    console.error("Callback handling failed:", err);
  }
});

app.listen(Number(PORT), () =>
  console.log(`Health server listening on :${PORT}`),
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

client.once(Events.ClientReady, (readyClient) =>
  console.log(`Discord ready as ${readyClient.user.tag}`),
);

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;

    const isDm = !message.guildId;
    const isAllowedUser =
      allowedUsers.size === 0 || allowedUsers.has(message.author.id);
    const isAllowedGuild =
      isDm || allowedGuilds.size === 0 || allowedGuilds.has(message.guildId);
    if (!isAllowedUser || !isAllowedGuild) return;

    const mentionedBot = message.mentions.has(client.user);
    if (!isDm && requireMention && !mentionedBot) return;

    let content = message.content || "";
    if (!isDm && mentionedBot) {
      content = content
        .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
        .trim();
    }
    if (!content && message.attachments.size === 0) return;

    await message.channel.sendTyping();

    const attachmentLines = [...message.attachments.values()].map(
      (a) => `- ${a.name || "attachment"}: ${a.url}`,
    );

    const contextText = [
      `Discord message received.`,
      `Author: ${message.author.username} (${message.author.id})`,
      `Channel type: ${isDm ? "DM" : "Guild"}`,
      message.guild ? `Guild: ${message.guild.name} (${message.guild.id})` : null,
      message.channel
        ? `Channel: ${message.channel.name || "DM"} (${message.channel.id})`
        : null,
      ``,
      `Message:`,
      content || "(no text)",
      attachmentLines.length
        ? `\nAttachments:\n${attachmentLines.join("\n")}`
        : null,
      ``,
      `Instruction: Reply naturally to the Discord user. Keep the answer suitable for Discord.`,
    ]
      .filter(Boolean)
      .join("\n");

    const sessionKey = isDm
      ? `hook:discord:dm:${message.author.id}:${message.id}`
      : `hook:discord:guild:${message.guildId}:channel:${message.channelId}:${message.id}`;

    pending.set(sessionKey, {
      channelId: message.channelId,
      userId: message.author.id,
      isDm,
      replyToMessageId: message.id,
      createdAt: Date.now(),
    });

    const callbackUrl = `${CALLBACK_BASE_URL.replace(/\/$/, "")}/openclaw-callback`;

    await callOpenClaw({
      message: contextText,
      sessionKey,
      callbackUrl,
    });
  } catch (err) {
    console.error("Message handling failed:", err);
    try {
      await message.reply(
        "Jay bridge bị lỗi khi xử lý tin này rồi anh ơi 🥲 Check Render logs giúp em nha.",
      );
    } catch {}
  }
});

async function callOpenClaw({ message, sessionKey, callbackUrl }) {
  const res = await fetch(OPENCLAW_HOOK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENCLAW_HOOK_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      agentId: "main",
      sessionKey,
      wakeMode: "now",
      deliver: true,
      mode: "webhook",
      to: callbackUrl,
      timeoutSeconds: 180,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenClaw hook failed ${res.status}: ${text.slice(0, 500)}`);
  }
  return text;
}

function extractReply(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload.trim();

  const candidates = [
    payload.reply,
    payload.text,
    payload.message,
    payload.output,
    payload.response,
    payload.assistant,
    payload.final,
    payload.content,
    payload.data?.reply,
    payload.data?.text,
    payload.data?.message,
    payload.data?.output,
    payload.data?.response,
    payload.result?.reply,
    payload.result?.text,
    payload.result?.message,
    payload.result?.output,
    payload.result?.response,
    payload.run?.reply,
    payload.run?.text,
    payload.run?.message,
    payload.run?.output,
    payload.run?.response,
  ];

  for (const v of candidates) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }

  if (Array.isArray(payload.messages)) {
    const last = [...payload.messages].reverse().find(
      (m) => m && typeof m === "object" && (m.role === "assistant" || m.type === "assistant"),
    );
    const c = last?.content ?? last?.text;
    if (typeof c === "string" && c.trim()) return c.trim();
    if (Array.isArray(c)) {
      const joined = c
        .map((p) =>
          typeof p === "string"
            ? p
            : typeof p?.text === "string"
              ? p.text
              : typeof p?.content === "string"
                ? p.content
                : "",
        )
        .filter(Boolean)
        .join("\n")
        .trim();
      if (joined) return joined;
    }
  }

  console.log("Unknown OpenClaw callback shape:", JSON.stringify(payload, null, 2).slice(0, 2000));
  return "";
}

async function sendDiscordReplyFromCtx(ctx, text) {
  const chunks = chunkText(text, 1900);

  if (ctx.isDm) {
    const user = await client.users.fetch(ctx.userId);
    const dm = await user.createDM();
    for (const c of chunks) await dm.send(c);
    return;
  }

  const channel = await client.channels.fetch(ctx.channelId);
  if (!channel || !channel.isTextBased()) return;

  for (let i = 0; i < chunks.length; i++) {
    if (i === 0 && ctx.replyToMessageId) {
      try {
        const original = await channel.messages.fetch(ctx.replyToMessageId);
        await original.reply(chunks[i]);
        continue;
      } catch {}
    }
    await channel.send(chunks[i]);
  }
}

function chunkText(text, maxLen) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.5) cut = rest.lastIndexOf(" ", maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

client.login(DISCORD_BOT_TOKEN).catch((err) => {
  console.error("Discord login failed:", err);
  process.exit(1);
});

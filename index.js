import express from "express";
import { Client, GatewayIntentBits, Partials, Events } from "discord.js";

const {
  DISCORD_BOT_TOKEN,
  OPENCLAW_HOOK_URL,
  OPENCLAW_HOOK_TOKEN,
  ALLOWED_USER_IDS = "",
  ALLOWED_GUILD_IDS = "",
  REQUIRE_MENTION = "true",
  PORT = "3000",
} = process.env;

if (!DISCORD_BOT_TOKEN) throw new Error("Missing DISCORD_BOT_TOKEN");
if (!OPENCLAW_HOOK_URL) throw new Error("Missing OPENCLAW_HOOK_URL");
if (!OPENCLAW_HOOK_TOKEN) throw new Error("Missing OPENCLAW_HOOK_TOKEN");

const allowedUsers = new Set(
  ALLOWED_USER_IDS.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

const allowedGuilds = new Set(
  ALLOWED_GUILD_IDS.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

const requireMention = REQUIRE_MENTION !== "false";

const app = express();

app.get("/", (_req, res) => {
  res.status(200).send("Jay Discord Bridge OK");
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "jay-discord-bridge",
    uptime: process.uptime(),
  });
});

app.listen(Number(PORT), () => {
  console.log(`Health server listening on :${PORT}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Discord ready as ${readyClient.user.tag}`);
});

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

    if (!isDm && requireMention && !mentionedBot) {
      return;
    }

    let content = message.content || "";

    if (!isDm && mentionedBot) {
      content = content
        .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
        .trim();
    }

    if (!content && message.attachments.size === 0) return;

    await message.channel.sendTyping();

    const attachmentLines = [...message.attachments.values()].map((a) => {
      return `- ${a.name || "attachment"}: ${a.url}`;
    });

    const contextText = [
      `Discord message received.`,
      `Author: ${message.author.username} (${message.author.id})`,
      `Channel type: ${isDm ? "DM" : "Guild"}`,
      message.guild
        ? `Guild: ${message.guild.name} (${message.guild.id})`
        : null,
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
      ? `hook:discord:dm:${message.author.id}`
      : `hook:discord:guild:${message.guildId}:channel:${message.channelId}`;

    const reply = await callOpenClaw({
      message: contextText,
      sessionKey,
    });

    const cleanReply = normalizeReply(reply);

    if (!cleanReply) {
      await message.reply(
        "Jay chưa trả lời được á anh, bridge nhận tin rồi nhưng hook chưa trả response.",
      );
      return;
    }

    await sendDiscordReply(message, cleanReply);
  } catch (err) {
    console.error("Message handling failed:", err);
    try {
      await message.reply(
        "Jay bridge bị lỗi khi xử lý tin này rồi anh ơi 🥲 Check Render logs giúp em nha.",
      );
    } catch {}
  }
});

async function callOpenClaw({ message, sessionKey }) {
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
      deliver: false,
      timeoutSeconds: 120,
    }),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(
      `OpenClaw hook failed ${res.status}: ${text.slice(0, 500)}`,
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeReply(payload) {
  if (!payload) return "";

  if (typeof payload === "string") {
    return payload.trim();
  }

  const candidates = [
    payload.reply,
    payload.text,
    payload.message,
    payload.output,
    payload.result,
    payload.response,
    payload.assistant,
    payload.assistantMessage,
    payload.final,
    payload.content,
    payload.data?.reply,
    payload.data?.text,
    payload.data?.message,
    payload.data?.output,
    payload.data?.result,
    payload.data?.response,
    payload.data?.assistant,
    payload.data?.assistantMessage,
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

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  if (Array.isArray(payload.messages)) {
    const lastAssistantMessage = [...payload.messages].reverse().find((msg) => {
      return (
        msg &&
        typeof msg === "object" &&
        (msg.role === "assistant" || msg.type === "assistant")
      );
    });

    const content = lastAssistantMessage?.content ?? lastAssistantMessage?.text;

    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }

    if (Array.isArray(content)) {
      const joined = content
        .map((part) => {
          if (typeof part === "string") return part;
          if (typeof part?.text === "string") return part.text;
          if (typeof part?.content === "string") return part.content;
          return "";
        })
        .filter(Boolean)
        .join("\n")
        .trim();

      if (joined) return joined;
    }
  }

  const json = JSON.stringify(payload, null, 2);
  console.log("Unknown OpenClaw response shape:", json.slice(0, 2000));

  return "";
}

async function sendDiscordReply(message, text) {
  const chunks = chunkText(text, 1900);

  for (let i = 0; i < chunks.length; i++) {
    if (i === 0) {
      await message.reply(chunks[i]);
    } else {
      await message.channel.send(chunks[i]);
    }
  }
}

function chunkText(text, maxLen) {
  const chunks = [];
  let rest = text.trim();

  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);

    if (cut < maxLen * 0.5) {
      cut = rest.lastIndexOf(" ", maxLen);
    }

    if (cut < maxLen * 0.5) {
      cut = maxLen;
    }

    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) {
    chunks.push(rest);
  }

  return chunks;
}

client.login(DISCORD_BOT_TOKEN).catch((err) => {
  console.error("Discord login failed:", err);
  process.exit(1);
});

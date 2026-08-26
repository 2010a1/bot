const fs = require("node:fs");
const path = require("node:path");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits
} = require("discord.js");

const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState
} = require("@discordjs/voice");

const Groq = require("groq-sdk");

// ============================================================
// CONFIG
// ============================================================

const configPath = path.join(__dirname, "config.json");

if (!fs.existsSync(configPath)) {
  console.error("❌ Không tìm thấy config.json");
  process.exit(1);
}

const config = require(configPath);

const DISCORD_TOKEN = config.DISCORD_TOKEN;
const GROQ_API_KEY = config.GROQ_API_KEY;
const CLIENT_ID = config.CLIENT_ID;

if (!DISCORD_TOKEN || !GROQ_API_KEY || !CLIENT_ID) {
  console.error("❌ config.json phải có DISCORD_TOKEN, GROQ_API_KEY và CLIENT_ID.");
  process.exit(1);
}

// ============================================================
// GROQ
// ============================================================

const groq = new Groq({
  apiKey: GROQ_API_KEY
});

const GROQ_MODEL = "llama-3.3-70b-versatile";

// ============================================================
// DISCORD CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ============================================================
// VOICE CONNECTIONS
// ============================================================

const voiceConnections = new Map();

// ============================================================
// AI CONVERSATIONS
// ============================================================

const conversations = new Map();
const MAX_HISTORY_MESSAGES = 21;

// ============================================================
// VOICE LOG
// ============================================================

const DATA_DIR = path.join(__dirname, "data");
const LOG_FILE = path.join(DATA_DIR, "voice-logs.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadVoiceLogs() {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      fs.writeFileSync(LOG_FILE, "[]", "utf8");
      return [];
    }

    const raw = fs.readFileSync(LOG_FILE, "utf8");

    if (!raw.trim()) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("❌ Không thể đọc voice log:", error);
    return [];
  }
}

let voiceLogs = loadVoiceLogs();

function saveVoiceLogs() {
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify(voiceLogs, null, 2), "utf8");
  } catch (error) {
    console.error("❌ Không thể lưu voice log:", error);
  }
}

function addVoiceLog({ guildId, userId, username, action, channelName }) {
  voiceLogs.push({
    timestamp: new Date().toISOString(),
    guildId,
    userId,
    username,
    action,
    channelName
  });

  if (voiceLogs.length > 10000) {
    voiceLogs = voiceLogs.slice(-10000);
  }

  saveVoiceLogs();
}

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Hiển thị hướng dẫn sử dụng bot."),

  new SlashCommandBuilder()
    .setName("join")
    .setDescription("Cho bot tham gia phòng voice hiện tại của bạn."),

  new SlashCommandBuilder()
    .setName("log")
    .setDescription("Hiển thị lịch sử ra/vào phòng voice.")
    .addIntegerOption(option =>
      option
        .setName("limit")
        .setDescription("Số lượng log muốn hiển thị. Mặc định 10.")
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(false)
    )
].map(command => command.toJSON());

// ============================================================
// REGISTER SLASH COMMANDS
// ============================================================

async function registerSlashCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  try {
    console.log("🔄 Đang đăng ký Slash Commands...");

    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: commands
    });

    console.log("✅ Đã đăng ký /help /join /log.");
  } catch (error) {
    console.error("❌ Đăng ký Slash Commands thất bại:", error);
  }
}

// ============================================================
// HELP EMBED
// ============================================================

function createHelpEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("🤖 Hướng dẫn sử dụng Discord Bot")
    .setDescription("Bot hỗ trợ AI Groq, voice logger và tự động chuyển lệnh cho bot nhạc.")
    .addFields(
      {
        name: "📖 /help",
        value: "Hiển thị bảng hướng dẫn sử dụng bot."
      },
      {
        name: "🎙️ /join",
        value: "Bot sẽ tham gia phòng voice mà bạn đang đứng.\nBot sử dụng `selfDeaf: true`."
      },
      {
        name: "📋 /log",
        value:
          "Xem lịch sử thành viên Join/Leave voice.\n\n" +
          "Ví dụ:\n`/log` → 10 log gần nhất\n`/log limit:25` → 25 log\n`/log limit:100` → 100 log"
      },
      {
        name: "🧠 Chat với AI",
        value:
          "Bắt đầu hội thoại mới bằng:\n`. Xin chào AI`\n\n" +
          "Dấu `.` phải nằm ở đầu tin nhắn. Hội thoại cũ của bạn sẽ được xóa."
      },
      {
        name: "💬 Tiếp tục hội thoại",
        value:
          "Reply trực tiếp vào tin nhắn AI mà bot đã gửi. Bot sẽ lấy lịch sử hội thoại và gửi câu hỏi tiếp theo cho Groq."
      },
      {
        name: "🎵 Tự động phát nhạc",
        value:
          "Link YouTube / Spotify / SoundCloud → `m!play {link}`\n" +
          "Từ khóa `stop` → `m!stop`\n" +
          "Từ khóa `skip` → `m!skip`"
      }
    )
    .setFooter({ text: "Groq AI • Discord.js v14" })
    .setTimestamp();
}

// ============================================================
// MUSIC LINK DETECTION
// ============================================================

const MUSIC_URL_REGEX =
  /https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|spotify\.com|soundcloud\.com)\/\S+/i;

function extractMusicUrl(content) {
  const match = content.match(MUSIC_URL_REGEX);
  return match ? match[0] : null;
}

function containsExactWord(content, word) {
  const regex = new RegExp(`(^|\\s)${word}(?=\\s|$)`, "i");
  return regex.test(content.trim());
}

async function sendMusicCommand(message, command) {
  try {
    await message.channel.send(command);
  } catch (error) {
    console.error(`❌ Không thể gửi music command "${command}":`, error);
  }
}

// ============================================================
// AI HELPERS
// ============================================================

function createNewConversation(userId) {
  const conversation = {
    messages: [
      {
        role: "system",
        content:
          "Bạn là một AI assistant hữu ích trong Discord. " +
          "Trả lời rõ ràng, tự nhiên, ưu tiên tiếng Việt nếu người dùng sử dụng tiếng Việt."
      }
    ],
    botMessageIds: new Set()
  };

  conversations.set(userId, conversation);
  return conversation;
}

function trimConversation(conversation) {
  const systemMessage = conversation.messages[0];
  const recentMessages = conversation.messages.slice(1).slice(-MAX_HISTORY_MESSAGES + 1);

  conversation.messages = [systemMessage, ...recentMessages];
}

async function askGroq(conversation) {
  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: conversation.messages,
    temperature: 0.7,
    max_tokens: 2048
  });

  return completion.choices?.[0]?.message?.content ||
    "Xin lỗi, AI không trả về nội dung.";
}

function splitMessage(content, maxLength = 1900) {
  const chunks = [];
  let remaining = content;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n", maxLength);

    if (splitAt < 500) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }

    if (splitAt < 1) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

async function sendAIResponse(message, conversation, response) {
  const chunks = splitMessage(response);

  for (const chunk of chunks) {
    const sent = await message.channel.send({ content: chunk });
    conversation.botMessageIds.add(sent.id);
  }
}

// ============================================================
// NEW AI CONVERSATION
// ============================================================

async function handleNewAIConversation(message) {
  const prompt = message.content.slice(1).trim();

  if (!prompt) {
    return;
  }

  conversations.delete(message.author.id);

  const conversation = createNewConversation(message.author.id);

  conversation.messages.push({
    role: "user",
    content: prompt
  });

  trimConversation(conversation);

  try {
    await message.channel.sendTyping();

    const response = await askGroq(conversation);

    conversation.messages.push({
      role: "assistant",
      content: response
    });

    trimConversation(conversation);

    await sendAIResponse(message, conversation, response);
  } catch (error) {
    console.error("❌ Groq error:", error);

    await message.channel.send("❌ Không thể kết nối với Groq AI lúc này.");
  }
}

// ============================================================
// CONTINUE AI REPLY
// ============================================================

async function handleAIReply(message) {
  if (!message.reference?.messageId) {
    return false;
  }

  const referencedMessageId = message.reference.messageId;

  let ownerConversation = null;

  for (const [userId, conversation] of conversations) {
    if (conversation.botMessageIds.has(referencedMessageId)) {
      ownerConversation = { userId, conversation };
      break;
    }
  }

  if (!ownerConversation) {
    return false;
  }

  if (ownerConversation.userId !== message.author.id) {
    return false;
  }

  const conversation = ownerConversation.conversation;

  conversation.messages.push({
    role: "user",
    content: message.content
  });

  trimConversation(conversation);

  try {
    await message.channel.sendTyping();

    const response = await askGroq(conversation);

    conversation.messages.push({
      role: "assistant",
      content: response
    });

    trimConversation(conversation);

    await sendAIResponse(message, conversation, response);

    return true;
  } catch (error) {
    console.error("❌ Groq reply error:", error);

    await message.channel.send("❌ Có lỗi khi tiếp tục hội thoại với AI.");

    return true;
  }
}

// ============================================================
// VOICE ACTIVITY LOGGER
// ============================================================

client.on("voiceStateUpdate", (oldState, newState) => {
  const member = newState.member || oldState.member;

  if (!member || member.user.bot) {
    return;
  }

  if (!oldState.channelId && newState.channelId) {
    addVoiceLog({
      guildId: newState.guild.id,
      userId: member.id,
      username: member.user.tag,
      action: "JOIN",
      channelName: newState.channel?.name || "Unknown"
    });

    return;
  }

  if (oldState.channelId && !newState.channelId) {
    addVoiceLog({
      guildId: oldState.guild.id,
      userId: member.id,
      username: member.user.tag,
      action: "LEAVE",
      channelName: oldState.channel?.name || "Unknown"
    });

    return;
  }

  if (
    oldState.channelId &&
    newState.channelId &&
    oldState.channelId !== newState.channelId
  ) {
    addVoiceLog({
      guildId: oldState.guild.id,
      userId: member.id,
      username: member.user.tag,
      action: "LEAVE",
      channelName: oldState.channel?.name || "Unknown"
    });

    addVoiceLog({
      guildId: newState.guild.id,
      userId: member.id,
      username: member.user.tag,
      action: "JOIN",
      channelName: newState.channel?.name || "Unknown"
    });
  }
});

// ============================================================
// /JOIN
// ============================================================

async function handleJoinCommand(interaction) {
  const member = interaction.member;

  if (!member?.voice?.channel) {
    await interaction.reply({
      content: "❌ Bạn phải vào một phòng voice trước khi sử dụng `/join`.",
      ephemeral: true
    });

    return;
  }

  const channel = member.voice.channel;

  try {
    const permissions = channel.permissionsFor(interaction.client.user);

    if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
      await interaction.reply({
        content: "❌ Bot không có quyền View Channel trong phòng voice này.",
        ephemeral: true
      });
      return;
    }

    if (!permissions?.has(PermissionFlagsBits.Connect)) {
      await interaction.reply({
        content: "❌ Bot không có quyền Connect vào phòng voice này.",
        ephemeral: true
      });
      return;
    }

    const existing = voiceConnections.get(interaction.guildId);

    if (existing) {
      try {
        existing.destroy();
      } catch {}
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    });

    voiceConnections.set(interaction.guildId, connection);

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch {
        try {
          connection.destroy();
        } catch {}

        voiceConnections.delete(interaction.guildId);
      }
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 15000);

    await interaction.reply({
      content: `✅ Đã vào **${channel.name}** và sẽ duy trì voice connection.`,
      ephemeral: true
    });
  } catch (error) {
    console.error("❌ Join voice error:", error);

    try {
      voiceConnections.get(interaction.guildId)?.destroy();
    } catch {}

    voiceConnections.delete(interaction.guildId);

    if (!interaction.replied) {
      await interaction.reply({
        content: "❌ Không thể tham gia phòng voice.",
        ephemeral: true
      });
    }
  }
}

// ============================================================
// /LOG
// ============================================================

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

async function handleLogCommand(interaction) {
  const limit = interaction.options.getInteger("limit") ?? 10;

  const guildLogs = voiceLogs
    .filter(log => log.guildId === interaction.guildId)
    .slice(-limit)
    .reverse();

  if (limit === 0 || guildLogs.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0x2B2D31)
      .setTitle("📋 Voice Activity Log")
      .setDescription("Không có log nào để hiển thị.")
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: true
    });

    return;
  }

  const lines = guildLogs.map((log, index) => {
    const icon = log.action === "JOIN" ? "🟢" : "🔴";
    const action = log.action === "JOIN" ? "Join" : "Leave";

    return (
      `**${index + 1}.** ${icon} **${action}**\n` +
      `👤 ${log.username}\n` +
      `🎙️ ${log.channelName}\n` +
      `🕒 ${formatTimestamp(log.timestamp)}`
    );
  });

  let description = "";

  for (const line of lines) {
    if (`${description}\n\n${line}`.length > 3900) {
      break;
    }

    description += (description ? "\n\n" : "") + line;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("📋 Voice Activity Log")
    .setDescription(description)
    .setFooter({
      text: `Hiển thị ${guildLogs.length} log gần nhất`
    })
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    ephemeral: true
  });
}

// ============================================================
// INTERACTIONS
// ============================================================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    switch (interaction.commandName) {
      case "help":
        await interaction.reply({
          embeds: [createHelpEmbed()]
        });
        break;

      case "join":
        await handleJoinCommand(interaction);
        break;

      case "log":
        await handleLogCommand(interaction);
        break;

      default:
        break;
    }
  } catch (error) {
    console.error("❌ Interaction error:", error);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "❌ Đã xảy ra lỗi khi xử lý lệnh.",
        ephemeral: true
      });
    } else {
      await interaction.reply({
        content: "❌ Đã xảy ra lỗi khi xử lý lệnh.",
        ephemeral: true
      });
    }
  }
});

// ============================================================
// MESSAGE HANDLER
// ============================================================

client.on("messageCreate", async message => {
  if (message.author.bot) {
    return;
  }

  const content = message.content.trim();

  if (!content) {
    return;
  }

  // Link YouTube / Spotify / SoundCloud -> m!play
  const musicUrl = extractMusicUrl(content);

  if (musicUrl) {
    await sendMusicCommand(message, `m!play ${musicUrl}`);
    return;
  }

  // Exact word "stop"
  if (containsExactWord(content, "stop")) {
    await sendMusicCommand(message, "m!stop");
    return;
  }

  // Exact word "skip"
  if (containsExactWord(content, "skip")) {
    await sendMusicCommand(message, "m!skip");
    return;
  }

  // New AI conversation: ". prompt"
  if (content.startsWith(".")) {
    await handleNewAIConversation(message);
    return;
  }

  // Continue AI conversation by replying to bot message
  if (message.reference?.messageId) {
    await handleAIReply(message);
  }
});

// ============================================================
// READY
// ============================================================

client.once("ready", async readyClient => {
  console.log("====================================");
  console.log(`🤖 Bot: ${readyClient.user.tag}`);
  console.log(`🆔 ID: ${readyClient.user.id}`);
  console.log(`🏠 Servers: ${readyClient.guilds.cache.size}`);
  console.log("====================================");

  await registerSlashCommands();

  readyClient.user.setPresence({
    activities: [{ name: "AI • /help", type: 0 }],
    status: "online"
  });
});

// ============================================================
// PROCESS ERROR HANDLING
// ============================================================

process.on("unhandledRejection", error => {
  console.error("❌ Unhandled Promise Rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("❌ Uncaught Exception:", error);
});

// ============================================================
// LOGIN
// ============================================================

console.log("🔄 Đang đăng nhập Discord...");
client.login(DISCORD_TOKEN);

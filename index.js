const { Client, GatewayIntentBits, SlashCommandBuilder, Routes } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const express = require('express');
const path = require('path');

// --- Cấu hình Bot ---
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages
    ]
});

// Giả lập database lưu các server đã vote 24/7 (Trong thực tế nên dùng MongoDB/Quick.db)
// Key: guildId, Value: true/false
global.votedGuilds = new Map(); 

// Link nhạc Lofi chất lượng cao (Stream URL ổn định)
const LOFI_URL = "https://stream.zeno.fm/0r0xa792kwzuv"; 

const player = createAudioPlayer();

// --- Server Express giữ bot luôn online ---
const app = express();
app.use(express.json());

// API nhận lệnh vote từ Web Vercel
app.post('/api/vote', (req, res) => {
    const { guildId } = req.body;
    if (!guildId) return res.status(400).json({ error: 'Thiếu Guild ID' });
    
    global.votedGuilds.set(guildId, true);
    res.json({ success: true, message: `Server ${guildId} đã kích hoạt 24/7!` });
});

app.get('/', (req, res) => {
    res.send('Bot Skull Music đang chạy 24/7!');
});

app.listen(process.env.PORT || 3000, () => {
    console.log('Server Uptime đã sẵn sàng.');
});

// --- Logic Discord Bot ---
client.once('ready', async () => {
    console.log(`Tôi đã đăng nhập thành công dưới tên: ${client.user.tag}`);
    
    // Đăng ký Slash Commands
    const commands = [
        new SlashCommandBuilder().setName('lofi').setDescription('Phát nhạc lofi 24/7'),
        new SlashCommandBuilder().setName('play').setDescription('Phát nhạc lofi'),
        new SlashCommandBuilder().setName('stop').setDescription('Dừng phát nhạc và rời kênh')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('Đã cập nhật các lệnh thành công!');
    } catch (error) {
        console.error(error);
    }
});

// Hàm xử lý vào phát nhạc
function playLofi(channel) {
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
    });

    const resource = createAudioResource(LOFI_URL);
    player.play(resource);
    connection.subscribe(player);
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, member, guildId } = interaction;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
        return interaction.reply({ content: 'Ní phải vào một kênh voice trước!', ephemeral: true });
    }

    if (commandName === 'lofi' || commandName === 'play') {
        await interaction.deferReply();
        try {
            playLofi(voiceChannel);
            await interaction.editReply(`✅ Đã tham gia thành công vào <#${voiceChannel.id}>`);
        } catch (error) {
            console.error(error);
            await interaction.editReply('Có lỗi xảy ra khi kết nối vào kênh!');
        }
    }

    if (commandName === 'stop') {
        const connection = getVoiceConnection(guildId);
        if (connection) {
            connection.destroy();
            await interaction.reply('⏹️ Đã dừng nhạc và rời kênh.');
        } else {
            await interaction.reply('Bot hiện tại không ở trong kênh nào.');
        }
    }
});

// --- Tự động thoát khi phòng trống (Xử lý Anti-Empty) ---
client.on('voiceStateUpdate', (oldState, newState) => {
    const botConnection = getVoiceConnection(oldState.guild.id);
    if (!botConnection) return;

    const botVoiceChannelId = botConnection.joinConfig.channelId;
    const channel = oldState.guild.channels.cache.get(botVoiceChannelId);

    if (channel && channel.members.size === 1) { // Chỉ còn lại duy nhất Bot
        // Kiểm tra xem server này đã VOTE kích hoạt 24/7 chưa
        const is247 = global.votedGuilds.get(oldState.guild.id);

        if (!is247) {
            setTimeout(() => {
                // Kiểm tra lại sau 5 giây xem có ai vào lại không
                if (channel.members.size === 1) {
                    botConnection.destroy();
                    
                    // Gửi tin nhắn thông báo về kênh chat hệ thống hoặc kênh text bất kỳ có quyền nhắn
                    const textChannel = oldState.guild.channels.cache.find(ch => ch.isTextBased());
                    if (textChannel) {
                        textChannel.send('Tôi đã mất kết nối vì tôi chỉ có kênh 1 mình. Hãy lên web vote để bật 24/7 nha ní!').catch(() => {});
                    }
                }
            }, 5000); 
        }
    }
});

client.login(TOKEN);


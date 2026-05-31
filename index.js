const { Client, GatewayIntentBits, SlashCommandBuilder, Routes } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection } = require('@discordjs/voice');
const express = require('express');

// --- Lấy cấu hình từ Biến Môi Trường (Environment Variables trên Render) ---
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages
    ]
});

// Bộ nhớ tạm lưu các server đã được kích hoạt 24/7 qua Web
global.votedGuilds = new Map(); 

// Link stream nhạc Lofi Piano/Sad cực kỳ ổn định, không lo die link
const LOFI_URL = "https://stream.zeno.fm/0r0xa792kwzuv"; 
const player = createAudioPlayer();

// --- Khởi tạo Server Express để UptimeRobot giữ bot luôn thức ---
const app = express();
app.use(express.json());

// Cho phép Web Vercel gọi API để kích hoạt chế độ 24/7 cho Server cụ thể
app.post('/api/vote', (req, res) => {
    const { guildId } = req.body;
    if (!guildId) return res.status(400).json({ error: 'Thiếu Guild ID' });
    
    global.votedGuilds.set(guildId, true);
    res.json({ success: true, message: `Server ${guildId} đã kích hoạt 24/7 thành công!` });
});

app.get('/', (req, res) => {
    res.send('Skull Music Bot đang hoạt động hoàn hảo 24/7!');
});

app.listen(process.env.PORT || 3000, () => {
    console.log('Server Web đồng hành cùng UptimeRobot đã kích hoạt.');
});

// --- Logic Hệ Thống Bot Discord ---
client.once('ready', async () => {
    console.log(`Đã kết nối thành công: ${client.user.tag}`);
    
    // Đăng ký Slash Commands ứng dụng
    const commands = [
        new SlashCommandBuilder().setName('lofi').setDescription('Kết nối và phát nhạc lofi 24/7'),
        new SlashCommandBuilder().setName('play').setDescription('Kết nối và phát nhạc lofi'),
        new SlashCommandBuilder().setName('stop').setDescription('Dừng phát nhạc hoàn toàn và rời phòng')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('Đã đồng bộ hóa các lệnh Slash thành công!');
    } catch (error) {
        console.error('Lỗi khi đồng bộ lệnh Slash: ', error);
    }
});

// Hàm kết nối và đẩy luồng nhạc vào phòng voice
function playMusicStream(channel) {
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
        return interaction.reply({ content: 'Ní ơi, ní phải vào một kênh voice trước thì tôi mới vào được!', ephemeral: true });
    }

    if (commandName === 'lofi' || commandName === 'play') {
        await interaction.deferReply();
        try {
            playMusicStream(voiceChannel);
            // Trả về đúng cú pháp: ✅ Đã tham gia thành công vào #id_kênh
            await interaction.editReply(`✅ Đã tham gia thành công vào <#${voiceChannel.id}>`);
        } catch (error) {
            console.error(error);
            await interaction.editReply('Lỗi rồi ní ơi! Không thể kết nối vào kênh voice được.');
        }
    }

    if (commandName === 'stop') {
        const connection = getVoiceConnection(guildId);
        if (connection) {
            connection.destroy();
            await interaction.reply('⏹️ Đã tắt nhạc và rời khỏi phòng voice.');
        } else {
            await interaction.reply('Hiện tại tôi có ở trong phòng nào đâu ní!');
        }
    }
});

// --- Tự động phát hiện phòng trống và thoát ---
client.on('voiceStateUpdate', (oldState, newState) => {
    const botConnection = getVoiceConnection(oldState.guild.id);
    if (!botConnection) return;

    const botVoiceChannelId = botConnection.joinConfig.channelId;
    const channel = oldState.guild.channels.cache.get(botVoiceChannelId);

    // Nếu phòng chỉ còn lại đúng 1 mình Bot
    if (channel && channel.members.size === 1) {
        const is247Active = global.votedGuilds.get(oldState.guild.id);

        // Nếu CHƯA ĐƯỢC VOTE 24/7 thì mới tự động thoát phòng
        if (!is247Active) {
            setTimeout(() => {
                // Kiểm tra lại sau 5 giây xem có ai vào lại cứu vớt không
                if (channel.members.size === 1) {
                    botConnection.destroy();
                    
                    // Tìm một kênh text hợp lệ trong server để nhắn thông báo rời đi
                    const textChannel = oldState.guild.channels.cache.find(ch => ch.isTextBased());
                    if (textChannel) {
                        textChannel.send('Tôi đã mất kết nối vì tôi chỉ có kênh 1 mình.').catch(() => {});
                    }
                }
            }, 5000);
        }
    }
});

client.login(TOKEN);

const { Client, GatewayIntentBits, SlashCommandBuilder, Routes } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, StreamType, AudioPlayerStatus } = require('@discordjs/voice');
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

// ĐƯỜNG DẪN LUỒNG PHÁT LIVE CHÍNH THỨC (Đồng bộ thời gian thực với luồng livestream YouTube Lofi Girl)
const LOFI_URL = "https://stream.nightride.fm/chilled.mp3"; 

// --- Khởi tạo Server Express để UptimeRobot giữ bot luôn thức ---
const app = express();
app.use(express.json());

// API nhận lệnh vote từ Web Vercel
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

// Hàm kết nối và ép luồng phát nhạc LIVE trực tiếp
function playMusicStream(channel) {
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
    });

    const localPlayer = createAudioPlayer();

    // Khởi tạo tài nguyên với định dạng Arbitrary để đọc luồng Live liên tục
    const resource = createAudioResource(LOFI_URL, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
    });
    
    // Đặt âm lượng dịu nhẹ (0.4 = 40% âm lượng gốc)
    resource.volume.setVolume(0.4);

    // Tiến hành phát luồng Live vào kết nối phòng voice
    localPlayer.play(resource);
    connection.subscribe(localPlayer);

    // Tự động kết nối lại luồng nếu bị rớt mạng giữa chừng (Giữ kết nối Live 24/7)
    localPlayer.on(AudioPlayerStatus.Idle, () => {
        console.log("Luồng Live bị ngắt quãng, đang tự động kết nối lại...");
        try {
            const retryResource = createAudioResource(LOFI_URL, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true
            });
            retryResource.volume.setVolume(0.4);
            localPlayer.play(retryResource);
        } catch (err) {
            console.error("Lỗi khi kết nối lại luồng Live:", err);
        }
    });

    localPlayer.on('error', error => {
        console.error(`Lỗi trình phát nhạc Live: ${error.message}`);
    });
    
    localPlayer.on(AudioPlayerStatus.Playing, () => {
        console.log('✅ Skull Music đã bắt đầu phát nhạc Live Lofi thành công!');
    });
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

        // Nếu CHƯA ĐƯỢC VOTE 24/7 thì mới tự động thoát phòng kèm lời nhắn
        if (!is247Active) {
            setTimeout(() => {
                if (channel.members.size === 1) {
                    botConnection.destroy();
                    
                    const textChannel = oldState.guild.channels.cache.find(ch => ch.isTextBased());
                    if (textChannel) {
                        textChannel.send('Tôi đã mất kết nối vì tôi chỉ có kênh 1 mình.').catch(() => {});
                    }
                }
            }, 5000); // 5 giây chờ đợi cứu vớt
        }
    }
});

client.login(TOKEN);

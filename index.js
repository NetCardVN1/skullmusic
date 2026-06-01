const { Client, GatewayIntentBits, SlashCommandBuilder, Routes } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection, StreamType, AudioPlayerStatus } = require('@discordjs/voice');
const express = require('express');

// --- Cấu hình lấy từ Biến môi trường trên Render ---
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages
    ]
});

// Bộ nhớ tạm để lưu danh sách các server đã được kích hoạt 24/7 qua Web
global.votedGuilds = new Map(); 

// Link stream nhạc lofi chính thức (Đồng bộ thời gian thực theo giây)
const LOFI_URL = "https://stream.nightride.fm/chilled.mp3"; 

// --- Khởi tạo Server Express để UptimeRobot ping giữ bot luôn thức ---
const app = express();
app.use(express.json());

// API nhận lệnh vote từ phía trang Web Vercel
app.post('/api/vote', (req, res) => {
    const { guildId } = req.body;
    if (!guildId) return res.status(400).json({ error: 'Thiếu Guild ID' });
    
    global.votedGuilds.set(guildId, true);
    res.json({ success: true, message: `Server ${guildId} đã kích hoạt chế độ 24/7!` });
});

app.get('/', (req, res) => {
    res.send('Skull Music Bot đang chạy Live 24/7 hoàn hảo!');
});

app.listen(process.env.PORT || 3000, () => {
    console.log('Server giữ uptime đã sẵn sàng hoạt động.');
});

// --- Sự kiện khi Bot đăng nhập thành công ---
client.once('ready', async () => {
    console.log(`Tôi đã đăng nhập thành công dưới tên: ${client.user.tag}`);
    
    // Đăng ký các Slash Commands bắt buộc
    const commands = [
        new SlashCommandBuilder().setName('lofi').setDescription('Kết nối và phát nhạc lofi 24/7'),
        new SlashCommandBuilder().setName('play').setDescription('Kết nối và phát nhạc lofi'),
        new SlashCommandBuilder().setName('stop').setDescription('Dừng nhạc và rời phòng voice')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('Đã cập nhật hệ thống lệnh Slash thành công!');
    } catch (error) {
        console.error('Lỗi cập nhật lệnh Slash:', error);
    }
});

// --- Hàm xử lý kết nối phòng và ép luồng phát nhạc LIVE ---
function playMusicStream(channel) {
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
    });

    const localPlayer = createAudioPlayer();

    // Sử dụng StreamType.Raw phối hợp với ffmpeg-static để ép âm thanh xuất ra ngay lập tức
    const resource = createAudioResource(LOFI_URL, {
        inputType: StreamType.Raw,
        inlineVolume: true
    });
    
    // Đặt âm lượng dịu nhẹ (0.5 = 50% âm lượng gốc)
    resource.volume.setVolume(0.5);

    localPlayer.play(resource);
    connection.subscribe(localPlayer);

    // Cơ chế tự nạp lại luồng khi bị rớt mạng giữa chừng (Giữ trạng thái Live liên tục)
    localPlayer.on(AudioPlayerStatus.Idle, () => {
        console.log("Luồng Live đứng im hoặc đổi gói tin, đang nạp lại...");
        try {
            const retryResource = createAudioResource(LOFI_URL, {
                inputType: StreamType.Raw,
                inlineVolume: true
            });
            retryResource.volume.setVolume(0.5);
            localPlayer.play(retryResource);
        } catch (err) {
            console.error("Lỗi tự động nạp lại luồng Live:", err);
        }
    });

    localPlayer.on('error', error => {
        console.error(`[Lỗi Trình Phát]: ${error.message}`);
        // Chế độ dự phòng tự động nếu luồng thô gặp lỗi đột xuất
        try {
            const backupResource = createAudioResource(LOFI_URL, { inlineVolume: true });
            backupResource.volume.setVolume(0.5);
            localPlayer.play(backupResource);
        } catch (e) {}
    });
    
    localPlayer.on(AudioPlayerStatus.Playing, () => {
        console.log('✅ Skull Music đã cất tiếng hát thành công ra phòng voice!');
    });
}

// --- Xử lý tương tác lệnh từ người dùng ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, member, guildId } = interaction;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
        return interaction.reply({ content: 'Ní phải vào một kênh voice trước thì tôi mới vào hát được chứ!', ephemeral: true });
    }

    if (commandName === 'lofi' || commandName === 'play') {
        await interaction.deferReply();
        try {
            playMusicStream(voiceChannel);
            // Trả về chính xác cú pháp ní yêu cầu: ✅ Đã tham gia thành công vào #123456789
            await interaction.editReply(`✅ Đã tham gia thành công vào <#${voiceChannel.id}>`);
        } catch (error) {
            console.error(error);
            await interaction.editReply('Có lỗi xảy ra khi kết nối vào phòng voice rồi ní ơi!');
        }
    }

    if (commandName === 'stop') {
        const connection = getVoiceConnection(guildId);
        if (connection) {
            connection.destroy();
            await interaction.reply('⏹️ Đã dừng nhạc và rời khỏi phòng.');
        } else {
            await interaction.reply('Hiện tại tôi có ở trong phòng nào đâu nè!');
        }
    }
});

// --- Hệ thống tự động kiểm tra phòng trống để thoát ---
client.on('voiceStateUpdate', (oldState, newState) => {
    const botConnection = getVoiceConnection(oldState.guild.id);
    if (!botConnection) return;

    const botVoiceChannelId = botConnection.joinConfig.channelId;
    const channel = oldState.guild.channels.cache.get(botVoiceChannelId);

    // Nếu phòng chỉ còn lại duy nhất một mình Bot ngồi lại
    if (channel && channel.members.size === 1) {
        // Kiểm tra xem server này đã kích hoạt tính năng Vote 24/7 chưa
        const is247Active = global.votedGuilds.get(oldState.guild.id);

        // Nếu chưa được Vote thì tiến hành đếm ngược thoát phòng
        if (!is247Active) {
            setTimeout(() => {
                // Kiểm tra lại sau 5 giây xem có ai vào lại phòng không
                if (channel.members.size === 1) {
                    botConnection.destroy();
                    
                    // Tìm một kênh chat chữ bất kỳ có quyền

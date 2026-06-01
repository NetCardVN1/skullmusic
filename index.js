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

// Bộ nhớ tạm lưu server đã vote 24/7
global.votedGuilds = new Map(); 

// Link stream nhạc lofi Radio chính thức của Lofi Girl (Băng thông cực cao và ổn định)
const LOFI_URL = "https://stream.nightride.fm/chilled.mp3"; 

// --- Khởi tạo Server Express để giữ uptime ---
const app = express();
app.use(express.json());

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

// --- Đồng bộ lệnh Slash ---
client.once('ready', async () => {
    console.log(`Tôi đã đăng nhập thành công: ${client.user.tag}`);
    
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

// --- Hàm xử lý phát nhạc Đã Được Vá Lỗi Im Lặng ---
function playMusicStream(channel) {
    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false, // Tắt chế độ điếc của bot để tránh Discord hiểu lầm bot treo ngầm
        selfMute: false  // Đảm bảo bot không tự mute
    });

    const localPlayer = createAudioPlayer();

    // Sử dụng kiểu đọc luồng Arbitrary kết hợp cấu hình đệm dữ liệu (inlineVolume)
    // Giúp đẩy trực tiếp dữ liệu âm thanh vào mạng Discord mà không cần convert thô qua child_process
    const resource = createAudioResource(LOFI_URL, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
    });
    
    // Đặt âm lượng ở mức 50%
    if (resource.volume) {
        resource.volume.setVolume(0.5);
    }

    localPlayer.play(resource);
    connection.subscribe(localPlayer);

    // Xử lý tự nạp lại luồng khi nhạc kết thúc hoặc đứng gói mạng
    localPlayer.on(AudioPlayerStatus.Idle, () => {
        console.log("Đang nạp lại luồng lofi mới...");
        try {
            const newResource = createAudioResource(LOFI_URL, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true
            });
            if (newResource.volume) newResource.volume.setVolume(0.5);
            localPlayer.play(newResource);
        } catch (err) {
            console.error("Lỗi tự nạp lại luồng:", err);
        }
    });

    localPlayer.on('error', error => {
        console.error(`[Trình phát lỗi]: ${error.message}`);
    });
    
    localPlayer.on(AudioPlayerStatus.Playing, () => {
        console.log('✅ Skull Music đã cất tiếng hát thành công ra phòng voice!');
    });
}

// --- Xử lý lệnh Slash ---
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
        const is247Active = global.votedGuilds.get(oldState.guild.id);

        if (!is247Active) {
            setTimeout(() => {
                if (channel.members.size === 1) {
                    botConnection.destroy();
                    
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

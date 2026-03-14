const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    Events,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AuditLogEvent,
    ChannelType,
    Message
} = require("discord.js");

const discordTranscripts = require('discord-html-transcripts');
const mysql = require('mysql2/promise');
const axios = require('axios');
const express = require('express');
const app = express();
app.use(express.json({ limit: '10mb' }));

const pool = mysql.createPool({
    host: 'database.discordbothosting.com',
    port: 3306,
    user: 'u3657_mt68vjv1sI',
    password: 'R^xbXC^om5sSNE@OfHzU4ch3',
    database: 's3657_CapitalRP'
});

async function initDatabase() {
    try {
        const connection = await pool.getConnection();
        await connection.query(`
            CREATE TABLE IF NOT EXISTS ticketSystem (
                id INT AUTO_INCREMENT PRIMARY KEY,
                staff_id VARCHAR(255) NOT NULL,
                staff_name VARCHAR(255) NOT NULL,
                ticket_name VARCHAR(255) NOT NULL,
                closed_date DATETIME NOT NULL,
                reason TEXT,
                INDEX idx_staff_id (staff_id),
                INDEX idx_closed_date (closed_date)
            )
        `);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS whitelistApplications (
                id INT AUTO_INCREMENT PRIMARY KEY,
                discord_id VARCHAR(255) NOT NULL UNIQUE,
                discord_username VARCHAR(255) NOT NULL,
                status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending',
                reviewed_by VARCHAR(255),
                reviewed_at DATETIME,
                submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_discord_id (discord_id),
                INDEX idx_status (status)
            )
        `);
        connection.release();
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Database initialization error:', error);
    }
}

async function logTicketClose(staffId, staffName, ticketName, reason) {
    try {
        const connection = await pool.getConnection();
        await connection.query(
            'INSERT INTO ticketSystem (staff_id, staff_name, ticket_name, closed_date, reason) VALUES (?, ?, ?, NOW(), ?)',
            [staffId, staffName, ticketName, reason]
        );
        connection.release();
    } catch (error) {
        console.error('Error logging ticket close:', error);
    }
}

async function getTicketStats(days = null) {
    try {
        const connection = await pool.getConnection();
        let totalClosedQuery = 'SELECT COUNT(*) as total FROM ticketSystem';
        let dateCondition = '';
        if (days) {
            dateCondition = ' WHERE closed_date >= DATE_SUB(NOW(), INTERVAL ? DAY)';
            totalClosedQuery += dateCondition;
        }
        const [totalClosedResult] = await connection.query(totalClosedQuery, days ? [days] : []);
        const totalClosed = totalClosedResult[0].total;
        let staffStatsQuery = `
            SELECT staff_id, staff_name, COUNT(*) as tickets_closed, MAX(closed_date) as last_closed
            FROM ticketSystem
            ${dateCondition}
            GROUP BY staff_id, staff_name
            ORDER BY tickets_closed DESC
        `;
        const [staffStats] = await connection.query(staffStatsQuery, days ? [days] : []);
        connection.release();
        return { totalClosed, staffStats };
    } catch (error) {
        console.error('Error getting ticket stats:', error);
        return { totalClosed: 0, staffStats: [] };
    }
}

function getTicketOwnerIdFromTopic(topic) {
    if (!topic) return null;
    const parts = topic.split(" - ");
    return parts?.[1] || null;
}

function getClaimedStaffIdFromTopic(topic) {
    if (!topic) return null;
    const parts = topic.split(" - ");
    const claimedPart = parts.find(p => p.startsWith("claimed:"));
    return claimedPart ? claimedPart.replace("claimed:", "") : null;
}

async function setClaimedInTopic(channel, staffId) {
    const topic = channel.topic || "";
    const parts = topic.split(" - ").filter(Boolean);
    const cleaned = parts.filter(p => !p.startsWith("claimed:"));
    cleaned.push(`claimed:${staffId}`);
    await channel.setTopic(cleaned.join(" - "));
}

async function clearClaimedInTopic(channel) {
    const topic = channel.topic || "";
    const parts = topic.split(" - ").filter(Boolean);
    const cleaned = parts.filter(p => !p.startsWith("claimed:"));
    await channel.setTopic(cleaned.join(" - "));
}

const { REST, Routes } = require('discord.js');
const config = require('./config.json');

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        const commands = require('./slash-deployment.js');
        await rest.put(
            Routes.applicationCommands(config.clientId),
            { body: commands }
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error deploying commands:', error);
    }
})();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
    ],
    allowedMentions: {
        parse: ["users", "roles"],
        repliedUser: true,
    },
});

let twitchAccessToken = null;
let streamersOnline = new Set();
let reminders = {};
const ticketCloseReasons = new Map();
const ticketSubscriptions = new Map();

async function getTwitchAccessToken() {
    try {
        const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: {
                client_id: config.twitchClientId,
                client_secret: config.twitchClientSecret,
                grant_type: 'client_credentials'
            }
        });
        twitchAccessToken = response.data.access_token;
        console.log('Twitch access token obtained');
    } catch (error) {
        console.error('Error getting Twitch access token:', error);
    }
}

async function checkStreamStatus(username) {
    try {
        const response = await axios.get('https://api.twitch.tv/helix/streams', {
            headers: {
                'Client-ID': config.twitchClientId,
                'Authorization': `Bearer ${twitchAccessToken}`
            },
            params: { user_login: username }
        });
        return response.data.data.length > 0 ? response.data.data[0] : null;
    } catch (error) {
        console.error(`Error checking stream status for ${username}:`, error);
        return null;
    }
}

async function checkAllStreamers() {
    try {
        const connection = await pool.getConnection();
        const [streamers] = await connection.query('SELECT * FROM twitchStreamers');
        connection.release();
        for (const streamer of streamers) {
            const streamData = await checkStreamStatus(streamer.twitch_username);
            if (streamData && !streamersOnline.has(streamer.user_id)) {
                streamersOnline.add(streamer.user_id);
                const streamChannel = await client.channels.fetch(config.StreamersChannel);
                const liveEmbed = new EmbedBuilder()
                    .setTitle(`🔴 ${streamData.user_name} is now LIVE!`)
                    .setDescription(`**${streamData.title}**\n\n[Watch Stream](https://twitch.tv/${streamer.twitch_username})`)
                    .addFields(
                        { name: 'Game', value: streamData.game_name || 'Not specified', inline: true },
                        { name: 'Viewers', value: streamData.viewer_count.toString(), inline: true }
                    )
                    .setColor('#9146FF')
                    .setThumbnail(`https://static-cdn.jtvnw.net/previews-ttv/live_user_${streamer.twitch_username}-440x248.jpg?timestamp=${Date.now()}`)
                    .setTimestamp();
                await streamChannel.send({
                    content: `<@${streamer.user_id}> is now live!`,
                    embeds: [liveEmbed]
                });
            } else if (!streamData && streamersOnline.has(streamer.user_id)) {
                streamersOnline.delete(streamer.user_id);
            }
        }
    } catch (error) {
        console.error('Error checking streamers:', error);
    }
}


client.on("messageReactionAdd", async (reaction, user) => {
    if (reaction.partial) await reaction.fetch()
    if (user.bot) return
    if (reaction.emoji.name !== "✅") return
    if (reaction.message.id !== client.verifyMessageId) return

    const guild = reaction.message.guild
    const member = await guild.members.fetch(user.id)

    if (member.roles.cache.has(config.verifyRole)) return

    await member.roles.add(config.verifyRole)

    const logsChannel = await client.channels.fetch(config.channelIdLogs)
    const embed = new EmbedBuilder()
        .setTitle("Member Verified ✅")
        .setDescription(`<@${user.id}> just verified and gained access to the server.`)
        .setColor(config.botColor)
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp()

    await logsChannel.send({ embeds: [embed] })
})

client.once(Events.ClientReady, async (c) => {
    console.log(`${c.user.displayName} is online`);

    await initDatabase();
    await getTwitchAccessToken();

    const [rows] = await pool.query("SELECT `value` FROM bot_config WHERE `key` = 'verifyMessageId'")
    if (rows.length > 0) {
        client.verifyMessageId = rows[0].value
        try {
            const verifyChannel = await client.channels.fetch(config.verifyChannel)
            await verifyChannel.messages.fetch(client.verifyMessageId)
            console.log(`Verify message cached: ${client.verifyMessageId}`)
        } catch (error) {
            console.error("Could not fetch verify message:", error)
        }
    }

    setInterval(async () => {
        await getTwitchAccessToken();
    }, 3600000);

    setInterval(async () => {
        await checkAllStreamers();
    }, 60000);

    setInterval(async () => {
        try {
            const freshGuild = await client.guilds.fetch(config.guildId);
            await client.user.setPresence({
                activities: [{ name: `Protecting ${freshGuild.memberCount} members`, type: 3 }],
            });
        } catch (error) {
            console.error("Status update failed", error);
        }
    }, 10000);

    const guild = await client.guilds.fetch(config.guildId);
    const logChannel = await client.channels.fetch(config.channelIdLogs);

    const startEmbed = new EmbedBuilder()
        .setTitle(`${c.user.displayName} is online!`)
        .setDescription("The bot started successfully")
        .setTimestamp()
        .setColor(config.botColor)
        .addFields(
            { name: "Status", value: "Online 🟢", inline: true },
            { name: "Members", value: `${guild.memberCount}`, inline: true },
            { name: "Channels", value: `${guild.channels.cache.size}`, inline: true }
        );
    await logChannel.send({ embeds: [startEmbed] });

    const ticketChannel = await client.channels.fetch(config.tickets.ticketsChannel);
    if (ticketChannel) {
        let fetched;
        do {
            fetched = await ticketChannel.messages.fetch({ limit: 100 });
            await ticketChannel.bulkDelete(fetched, true);
        } while (fetched.size >= 2);
    }

    const ticketEmbed = new EmbedBuilder()
        .setTitle("Capital RP Tickets")
        .setDescription(
            `Before opening a ticket please make sure to read through and open the correct ticket, or your ticket will be closed by a member of our staff team!\n\n` +
            `Please do not ping any staff member in your ticket to get a quicker response our staff team will get to you as soon as they can.\n\n` +
            `**General Support** - If you have any questions or enquiries about our server, or having any repeated issues feel free to use this to open a ticket.\n\n` +
            `**Store Enquiries** - If you have any enquiries before purchasing something through our tebex store or any issues with our tebex products.\n\n` +
            `**Gang Enquiries** - To report anything gang related.\n\n` +
            `**Car Issue Enquiries** - For car-related problems or questions.\n\n` +
            `**Player Report** - If you are looking to report a player for rule breaks. Please make sure you have solid proof such as a clip before opening a ticket.\n\n` +
            `**Management Enquiries** - For management-level discussions.`
        )
        .setColor(config.botColor)
        .setThumbnail(guild.iconURL({ size: 512 }))
        .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("tickets")
        .setPlaceholder("🫸 Select an option")
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel("General Enquiries")
                .setValue("general-ticket")
                .setDescription("For general questions and information")
                .setEmoji("📋"),
            new StringSelectMenuOptionBuilder()
                .setLabel("Store Enquiries")
                .setValue("store-ticket")
                .setDescription("For questions about the store")
                .setEmoji("🏪"),
            new StringSelectMenuOptionBuilder()
                .setLabel("Gang Enquiries")
                .setValue("gang-ticket")
                .setDescription("To report anything gang related")
                .setEmoji("🐛"),
            new StringSelectMenuOptionBuilder()
                .setLabel("Car Issue Enquiries")
                .setValue("car-ticket")
                .setDescription("For car-related problems or questions")
                .setEmoji("🚗"),
            new StringSelectMenuOptionBuilder()
                .setLabel("Report Enquiries")
                .setValue("report-ticket")
                .setDescription("To report issues or concerns")
                .setEmoji("📝"),
            new StringSelectMenuOptionBuilder()
                .setLabel("Management Enquiries")
                .setValue("management-ticket")
                .setDescription("For management-level discussions")
                .setEmoji("👔"),
            new StringSelectMenuOptionBuilder()
                .setLabel("Staff Only")
                .setValue("staff-ticket")
                .setDescription("Ticket for staff members only")
                .setEmoji("✨")
        );

    const ticketRow = new ActionRowBuilder().addComponents(selectMenu);
    await ticketChannel.send({ embeds: [ticketEmbed], components: [ticketRow] });
});
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!message.channel.topic?.toLowerCase().includes("ticket")) return;
    const subs = ticketSubscriptions.get(message.channel.id);
    if (!subs || subs.size === 0) return;
    for (const userId of subs) {
        if (userId === message.author.id) continue;
        try {
            const user = await client.users.fetch(userId);
            const embed = new EmbedBuilder()
                .setTitle("📩 New Ticket Message")
                .setDescription(`New message in **${message.channel.name}**`)
                .setColor(config.botColor)
                .addFields(
                    { name: "Author", value: `${message.author.tag}`, inline: true },
                    { name: "Channel", value: `<#${message.channel.id}>`, inline: true },
                    { name: "Message", value: message.content || "*No text content*", inline: false }
                )
                .setTimestamp();
            await user.send({ embeds: [embed] });
        } catch (error) {
            console.error(`Could not DM user ${userId}:`, error);
        }
    }
});

client.on(Events.GuildMemberAdd, async (member) => {
    try {
        const guild = await client.guilds.fetch(config.guildId);

        await client.user.setPresence({
            activities: [{ name: `${guild.memberCount} Members`, type: 3 }],
        });

        const memberRole = await guild.roles.fetch(config.memberRole);
        if (memberRole) {
            await member.roles.add(memberRole);
        }

        const welcomeChannel = await client.channels.fetch(config.welcomeChannelId);
        if (!welcomeChannel?.isTextBased()) return;

        const welcomeEmbed = new EmbedBuilder()
            .setTitle(`Welcome to ${guild.name}`)
            .setDescription(`Hello! <@${member.user.id}> Welcome to **${guild.name}!** You are member number **${guild.memberCount}**!`)
            .setColor(config.botColor)
            .setThumbnail(member.displayAvatarURL({ size: 64 }))
            .setTimestamp();
        await welcomeChannel.send({ embeds: [welcomeEmbed] });

        const joinLogChannel = await client.channels.fetch(config.leaveJoinLogsChannelId);
        const joinEmbed = new EmbedBuilder()
            .setTitle("User Joined!")
            .setColor("DFC5FE")
            .setTimestamp()
            .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
            .addFields(
                { name: "Name", value: `<@${member.user.id}>`, inline: true },
                { name: "Discord ID", value: `\`\`\`${member.user.id}\`\`\``, inline: false },
                { name: "Created", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`, inline: true }
            );
        await joinLogChannel.send({ embeds: [joinEmbed] });
    } catch (error) {
        console.error('Error in GuildMemberAdd event:', error);
    }
});

client.on(Events.GuildMemberRemove, async (member) => {
    try {
        const logChannel = await client.channels.fetch(config.channelIdLogs);
        const leaveJoinLogChannel = await client.channels.fetch(config.leaveJoinLogsChannelId);
        const guild = await client.guilds.fetch(config.guildId);

        await client.user.setPresence({
            activities: [{ name: `${guild.memberCount} Members`, type: 3 }],
        });

        await new Promise(resolve => setTimeout(resolve, 2000));

        const fetchedLogs = await member.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberKick,
        });
        const kickLog = fetchedLogs.entries.first();

        if (kickLog && kickLog.target.id === member.id && Date.now() - kickLog.createdTimestamp < 10000) {
            const embed = new EmbedBuilder()
                .setTitle("Member Kicked")
                .setColor("Orange")
                .setTimestamp()
                .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
                .addFields(
                    { name: "User", value: `<@${member.user.id}>`, inline: false },
                    { name: "Kicked By", value: `<@${kickLog.executor.id}>`, inline: false },
                    { name: "Reason", value: `${kickLog.reason || "No reason provided"}`, inline: false },
                    { name: "Discord ID", value: `\`\`\`${member.user.id}\`\`\``, inline: false },
                    { name: "Created", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`, inline: true }
                );
            await logChannel.send({ embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setTitle("User Left!")
                .setColor("Red")
                .setTimestamp()
                .setThumbnail(member.user.displayAvatarURL({ size: 512 }))
                .addFields(
                    { name: "Name", value: `<@${member.user.id}>`, inline: true },
                    { name: "Discord ID", value: `\`\`\`${member.user.id}\`\`\``, inline: false },
                    { name: "Created", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`, inline: true }
                );
            await leaveJoinLogChannel.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error('Error in GuildMemberRemove:', error);
    }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
        const logChannel = await client.channels.fetch(config.channelIdLogs);

        if (!oldMember.communicationDisabledUntil && newMember.communicationDisabledUntil) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const fetchedLogs = await newMember.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberUpdate });
            const timeoutLog = fetchedLogs.entries.first();
            if (timeoutLog && timeoutLog.target.id === newMember.id) {
                const { executor, reason } = timeoutLog;
                const embed = new EmbedBuilder()
                    .setTitle("Member Timed Out")
                    .setColor("Yellow")
                    .setTimestamp()
                    .setThumbnail(newMember.user.displayAvatarURL({ size: 512 }))
                    .addFields(
                        { name: "User", value: `<@${newMember.user.id}>`, inline: false },
                        { name: "Timed Out By", value: `<@${executor.id}>`, inline: false },
                        { name: "Until", value: `<t:${Math.floor(newMember.communicationDisabledUntil.getTime() / 1000)}:F>`, inline: false },
                        { name: "Reason", value: `${reason || "No reason provided"}`, inline: false }
                    );
                await logChannel.send({ embeds: [embed] });
            }
        }

        if (oldMember.communicationDisabledUntil && !newMember.communicationDisabledUntil) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const fetchedLogs = await newMember.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberUpdate });
            const timeoutLog = fetchedLogs.entries.first();
            if (timeoutLog && timeoutLog.target.id === newMember.id) {
                const { executor } = timeoutLog;
                const embed = new EmbedBuilder()
                    .setTitle("Timeout Removed")
                    .setColor("Green")
                    .setTimestamp()
                    .setThumbnail(newMember.user.displayAvatarURL({ size: 512 }))
                    .addFields(
                        { name: "User", value: `<@${newMember.user.id}>`, inline: false },
                        { name: "Removed By", value: `<@${executor.id}>`, inline: false }
                    );
                await logChannel.send({ embeds: [embed] });
            }
        }

        const oldRoles = oldMember.roles.cache;
        const newRoles = newMember.roles.cache;

        const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
        if (addedRoles.size > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const fetchedLogs = await newMember.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberRoleUpdate });
            const roleLog = fetchedLogs.entries.first();
            if (roleLog && roleLog.target.id === newMember.id) {
                const { executor } = roleLog;
                const roleList = addedRoles.map(role => `<@&${role.id}>`).join(', ');
                const embed = new EmbedBuilder()
                    .setTitle("Role(s) Added")
                    .setColor("Green")
                    .setTimestamp()
                    .setThumbnail(newMember.user.displayAvatarURL({ size: 512 }))
                    .addFields(
                        { name: "User", value: `<@${newMember.user.id}>`, inline: false },
                        { name: "Added By", value: `<@${executor.id}>`, inline: false },
                        { name: "Roles Added", value: roleList, inline: false }
                    );
                await logChannel.send({ embeds: [embed] });
            }
        }

        const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));
        if (removedRoles.size > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const fetchedLogs = await newMember.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberRoleUpdate });
            const roleLog = fetchedLogs.entries.first();
            if (roleLog && roleLog.target.id === newMember.id) {
                const { executor } = roleLog;
                const roleList = removedRoles.map(role => `<@&${role.id}>`).join(', ');
                const embed = new EmbedBuilder()
                    .setTitle("Role(s) Removed")
                    .setColor("Red")
                    .setTimestamp()
                    .setThumbnail(newMember.user.displayAvatarURL({ size: 512 }))
                    .addFields(
                        { name: "User", value: `<@${newMember.user.id}>`, inline: false },
                        { name: "Removed By", value: `<@${executor.id}>`, inline: false },
                        { name: "Roles Removed", value: roleList, inline: false }
                    );
                await logChannel.send({ embeds: [embed] });
            }
        }
    } catch (error) {
        console.error('Error in GuildMemberUpdate:', error);
    }
});

client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
    if (oldMsg.partial) await oldMsg.fetch();
    if (newMsg.partial) await newMsg.fetch();
    if (newMsg.author.bot) return;
    if (oldMsg.content === newMsg.content) return;
    const logChannel = await client.channels.fetch(config.channelIdLogs);
    const embed = new EmbedBuilder()
        .setTitle("Message was Edited")
        .setColor("Blue")
        .setThumbnail(oldMsg.author.avatarURL({ size: 512 }))
        .setTimestamp()
        .addFields(
            { name: "Author", value: `<@${oldMsg.author.id}>` },
            { name: "Channel", value: `<#${oldMsg.channel.id}>` },
            { name: "Before", value: oldMsg.content || "*No content*" },
            { name: "After", value: newMsg.content || "*No content*" }
        );
    await logChannel.send({ embeds: [embed] });
});

client.on("messageDelete", async (message) => {
    if (message.author?.id === config.clientId) return;
    if (message.partial) return;
    const logChannel = await client.channels.fetch(config.channelIdLogs);
    const embed = new EmbedBuilder()
        .setTitle("Message was Deleted")
        .setColor("Red")
        .setThumbnail(message.author.avatarURL({ size: 512 }))
        .setTimestamp()
        .addFields(
            { name: "Author", value: `<@${message.author.id}>` },
            { name: "Channel", value: `<#${message.channel.id}>` },
            { name: "Message", value: message.content || "*No content*" }
        );
    await logChannel.send({ embeds: [embed] });
});

client.on(Events.GuildBanAdd, async (ban) => {
    const logChannel = await client.channels.fetch(config.channelIdLogs);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const fetchedLogs = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd });
    const banLog = fetchedLogs.entries.first();
    if (banLog) {
        const { executor, reason } = banLog;
        const embed = new EmbedBuilder()
            .setTitle("Member Banned")
            .setTimestamp()
            .setColor("Red")
            .setThumbnail(ban.user.displayAvatarURL())
            .addFields(
                { name: "User", value: `<@${ban.user.id}>`, inline: false },
                { name: "Admin", value: `<@${executor.id}>`, inline: false },
                { name: "Reason", value: `${reason || "No reason provided"}`, inline: false }
            );
        await logChannel.send({ embeds: [embed] });
    } else {
        const embed = new EmbedBuilder()
            .setTitle("Member Banned")
            .setTimestamp()
            .setColor("Red")
            .setThumbnail(ban.user.displayAvatarURL())
            .addFields(
                { name: "User", value: `<@${ban.user.id}>`, inline: false },
                { name: "Admin", value: "Unknown (audit log not available)", inline: false },
                { name: "Reason", value: "No reason provided", inline: false }
            );
        await logChannel.send({ embeds: [embed] });
    }
});

client.on(Events.GuildBanRemove, async (ban) => {
    const logChannel = await client.channels.fetch(config.channelIdLogs);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const fetchedLogs = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanRemove });
    const banLog = fetchedLogs.entries.first();
    if (banLog) {
        const { executor } = banLog;
        const embed = new EmbedBuilder()
            .setTitle("Member Unbanned")
            .setTimestamp()
            .setColor("Green")
            .setThumbnail(ban.user.displayAvatarURL())
            .addFields(
                { name: "User", value: `<@${ban.user.id}>`, inline: false },
                { name: "Admin", value: `<@${executor.id}>`, inline: false }
            );
        await logChannel.send({ embeds: [embed] });
    } else {
        const embed = new EmbedBuilder()
            .setTitle("Member Unbanned")
            .setTimestamp()
            .setColor("Green")
            .setThumbnail(ban.user.displayAvatarURL())
            .addFields(
                { name: "User", value: `<@${ban.user.id}>`, inline: false },
                { name: "Admin", value: "Unknown (audit log not available)", inline: false }
            );
        await logChannel.send({ embeds: [embed] });
    }
});

setInterval(() => {
    const now = Date.now();
    for (const userId in reminders) {
        reminders[userId] = reminders[userId].filter(rem => {
            if (now >= rem.reminderTime) {
                const embed = new EmbedBuilder()
                    .setTitle(`⏰ Reminder`)
                    .setColor(config.botColor)
                    .setDescription(rem.reminder)
                    .setTimestamp();
                client.users.fetch(userId).then(user => {
                    user.send({ embeds: [embed] });
                }).catch(console.error);
                return false;
            }
            return true;
        });
    }
}, 60000);

function buildTicketButtons() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId("close")
                .setLabel("Close")
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId("claim-ticket")
                .setLabel("Claim")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId("unclaim-ticket")
                .setLabel("Unclaim")
                .setStyle(ButtonStyle.Secondary)
        );
}

async function createTicket({ guild, user, i, name, topic, category, reason, title, staffPing = true }) {
    const channel = await guild.channels.create({
        name: name.toLowerCase(),
        type: ChannelType.GuildText,
        parent: category,
        topic: topic,
        reason: reason
    });

    await channel.permissionOverwrites.create(user, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
    });

    await i.reply({
        content: `<#${channel.id}> has been created for you!💛`,
        flags: MessageFlags.Ephemeral
    });

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(`Hello <@${user.id}>, thank you for getting in touch with us. Please let us know how we can help you and one of our <@&${config.staffRole}> will assist you`)
        .setThumbnail(guild.iconURL({ size: 512 }))
        .setTimestamp()
        .setColor(config.botColor);

    await channel.send({
        content: staffPing ? `<@&${config.staffRole}>` : undefined,
        embeds: [embed],
        components: [buildTicketButtons()]
    });
}

async function closeTicket({ i, reason, isButton = false }) {
    const userId = i.channel.topic?.split(' - ')[1];
    const guild = await client.guilds.fetch(config.guildId);

    if (!isButton) {
        await i.deferReply({ flags: MessageFlags.Ephemeral });
    }

    try {
        await logTicketClose(i.user.id, i.user.tag, i.channel.name, reason);

        const attachment = await discordTranscripts.createTranscript(i.channel);
        const attachment2 = await discordTranscripts.createTranscript(i.channel);

        const logChannel = await client.channels.fetch(config.tickets.ticketLogs);

        const logEmbed = new EmbedBuilder()
            .setTitle("🔒 Ticket Closed")
            .setDescription(`A support ticket has been closed in **${guild.name}**.`)
            .setColor("Red")
            .setThumbnail(guild.iconURL({ size: 512, dynamic: true }))
            .setTimestamp()
            .addFields(
                { name: "📋 Ticket", value: `${i.channel.name}`, inline: false },
                { name: "👤 Ticket Creator", value: `<@${userId}>`, inline: true },
                { name: "🔨 Closed By", value: `<@${i.user.id}>`, inline: true },
                { name: "📅 Closed At", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
                { name: "📝 Reason", value: `${reason}`, inline: false },
                { name: "📎 Transcript", value: "Full conversation transcript attached.", inline: false }
            )
            .setFooter({ text: `${guild.name} • Ticket Logs`, iconURL: guild.iconURL({ size: 64 }) });

        const logEmbedUser = new EmbedBuilder()
            .setTitle("🔒 Your Ticket Has Been Closed")
            .setDescription(`Your support ticket in **${guild.name}** has been closed.`)
            .setColor("Red")
            .setThumbnail(guild.iconURL({ size: 512, dynamic: true }))
            .setTimestamp()
            .addFields(
                { name: "📋 Ticket Name", value: `${i.channel.name}`, inline: false },
                { name: "👤 Closed By", value: `<@${i.user.id}>`, inline: true },
                { name: "📅 Closed At", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                { name: "📝 Reason", value: `${reason}`, inline: false },
                { name: "📎 Transcript", value: "A full transcript of this ticket has been attached.", inline: false }
            )
            .setFooter({ text: `${guild.name} • Ticket System`, iconURL: guild.iconURL({ size: 64 }) });

        await logChannel.send({ embeds: [logEmbed], files: [attachment] });

        try {
            const ticketCreator = await client.users.fetch(userId);
            await ticketCreator.send({ embeds: [logEmbedUser], files: [attachment2] });
        } catch (error) {
            if (error.code !== 50007) console.error("Error sending DM:", error);
        }

        if (!isButton) {
            await i.editReply({ content: "Closing ticket...", flags: MessageFlags.Ephemeral });
        }

        ticketCloseReasons.delete(i.channel.id);
        ticketSubscriptions.delete(i.channel.id);
        await i.channel.delete(reason);
    } catch (error) {
        console.error("Error closing ticket:", error);
        try {
            if (!isButton) {
                await i.editReply({ content: "❌ Error closing ticket!", flags: MessageFlags.Ephemeral });
            }
        } catch {}
    }
}

client.on("interactionCreate", async (i) => {
    const guild = await client.guilds.fetch(config.guildId);

    if (i.isButton()) {
        if (i.customId.startsWith('pull_confirm_')) {
        const repo = i.customId.replace('pull_confirm_', '');

        await i.deferUpdate();

        try {
            const response = await axios.post(config.pullServerUrl, {
                secret: config.pullServerSecret,
                repo: repo
            });

            const result = response.data;

        const output = result.output || 'Already up to date.';
        const truncatedOutput = output.length > 900 ? output.slice(0, 900) + '...' : output;

        const embed = new EmbedBuilder()
            .setTitle(`✅ Pull Successful — ${repo}`)
            .setColor('Green')
            .setTimestamp()
            .setFooter({ text: `Pulled by ${i.user.tag}`, iconURL: i.user.displayAvatarURL() })
            .addFields(
                { name: 'Output', value: `\`\`\`${truncatedOutput}\`\`\``, inline: false }
            );
            await i.editReply({ embeds: [embed], components: [] });

        } catch (error) {
            console.error('Pull error:', error);
const embed = new EmbedBuilder()
    .setTitle(`❌ Pull Failed — ${repo}`)
    .setColor('Red')
    .setTimestamp()
    .addFields(
        { name: 'Error', value: `\`\`\`${JSON.stringify(error?.response?.data) || error.message}\`\`\``, inline: false }
    );
            await i.editReply({ embeds: [embed], components: [] });
        }
    }

    if (i.customId.startsWith('pull_cancel_')) {
        const repo = i.customId.replace('pull_cancel_', '');
        const embed = new EmbedBuilder()
            .setTitle(`🚫 Pull Cancelled — ${repo}`)
            .setColor('Red')
            .setTimestamp()
            .setFooter({ text: `Cancelled by ${i.user.tag}`, iconURL: i.user.displayAvatarURL() });

        await i.update({ embeds: [embed], components: [] });
    }
        if (i.customId === "rclose-btn") {
            if (!i.channel.topic?.toLowerCase().includes("ticket")) {
                return i.reply({ content: "❌ This is not a ticket channel!", flags: MessageFlags.Ephemeral });
            }
            const modal = new ModalBuilder().setCustomId("rclose-modal-ticket").setTitle("Close Reason");
            const reason = new TextInputBuilder()
                .setCustomId("rclose-reason")
                .setLabel("Close Reason")
                .setPlaceholder("Enter your reason as to why we can close this ticket")
                .setStyle(TextInputStyle.Paragraph);
            modal.addComponents(new ActionRowBuilder().addComponents(reason));
            await i.showModal(modal);
        }

        if (i.customId === "rclose-cancel-btn") {
            const modal = new ModalBuilder().setCustomId("rclose-modal").setTitle("Cancel Closure");
            const reason = new TextInputBuilder()
                .setCustomId("reason")
                .setLabel("Why do you want to keep the ticket open?")
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder("Explain why you want to keep the ticket open")
                .setMaxLength(1000);
            modal.addComponents(new ActionRowBuilder().addComponents(reason));
            await i.showModal(modal);
        }

        // ── Whitelist accept ──────────────────────────────────────────────────
        if (i.customId.startsWith('wl_accept_')) {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: '❌ You do not have permission to do this.', flags: MessageFlags.Ephemeral });
            }
            const applicantId = i.customId.replace('wl_accept_', '');
            await i.deferUpdate();

            try {
                const connection = await pool.getConnection();
                await connection.query(
                    `UPDATE whitelistApplications SET status = 'accepted', reviewed_by = ?, reviewed_at = NOW() WHERE discord_id = ?`,
                    [i.user.id, applicantId]
                );
                connection.release();

                const member = await guild.members.fetch(applicantId).catch(() => null);
                if (member && config.whitelistRole) {
                    await member.roles.add(config.whitelistRole).catch(() => null);
                }

                try {
                    const applicantUser = await client.users.fetch(applicantId);
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('Whitelist Application — Accepted')
                        .setDescription('Congratulations! Your whitelist application for **Capital Roleplay** has been accepted.\n\nWelcome to the city — see you in the server.')
                        .setColor('#4ade80')
                        .setTimestamp();
                    await applicantUser.send({ embeds: [dmEmbed] });
                } catch { /* DMs disabled */ }

                const acceptedEmbed = new EmbedBuilder()
                    .setTitle('Whitelist Application — Accepted ✅')
                    .setColor('#4ade80')
                    .setDescription(`Application accepted by <@${i.user.id}>`)
                    .setTimestamp();
                await i.editReply({ embeds: [acceptedEmbed], components: [] });
            } catch (error) {
                console.error('Whitelist accept error:', error);
                await i.followUp({ content: '❌ Failed to process acceptance.', flags: MessageFlags.Ephemeral });
            }
        }

        // ── Whitelist reject ──────────────────────────────────────────────────
        if (i.customId.startsWith('wl_reject_')) {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: '❌ You do not have permission to do this.', flags: MessageFlags.Ephemeral });
            }
            const applicantId = i.customId.replace('wl_reject_', '');
            const modal = new ModalBuilder()
                .setCustomId(`wl_reject_reason_${applicantId}`)
                .setTitle('Reject Application');
            const reasonInput = new TextInputBuilder()
                .setCustomId('reject_reason')
                .setLabel('Reason for rejection')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Explain why this application is being rejected...')
                .setMinLength(10)
                .setMaxLength(1000);
            modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
            await i.showModal(modal);
        }

        if (i.customId === "claim-ticket") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: "❌ You do not have permission to do this!", flags: MessageFlags.Ephemeral });
            }
            if (!i.channel.topic?.toLowerCase().includes("ticket")) {
                return i.reply({ content: "❌ This is not a ticket channel!", flags: MessageFlags.Ephemeral });
            }
            const ownerId = getTicketOwnerIdFromTopic(i.channel.topic);
            if (!ownerId) {
                return i.reply({ content: "❌ Could not determine ticket owner from channel topic.", flags: MessageFlags.Ephemeral });
            }
            const alreadyClaimedBy = getClaimedStaffIdFromTopic(i.channel.topic);
            if (alreadyClaimedBy) {
                return i.reply({ content: `❌ This ticket is already claimed by <@${alreadyClaimedBy}>.`, flags: MessageFlags.Ephemeral });
            }
            await setClaimedInTopic(i.channel, i.user.id);
            const embed = new EmbedBuilder()
                .setDescription(`✅ <@${i.user.id}> claimed this ticket.`)
                .setTimestamp()
                .setColor(config.botColor);
            await i.reply({ embeds: [embed] });
        }

        if (i.customId === "unclaim-ticket") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: "❌ You do not have permission to do this!", flags: MessageFlags.Ephemeral });
            }
            if (!i.channel.topic?.toLowerCase().includes("ticket")) {
                return i.reply({ content: "❌ This is not a ticket channel!", flags: MessageFlags.Ephemeral });
            }
            const ownerId = getTicketOwnerIdFromTopic(i.channel.topic);
            if (!ownerId) {
                return i.reply({ content: "❌ Could not determine ticket owner from channel topic.", flags: MessageFlags.Ephemeral });
            }
            const claimedBy = getClaimedStaffIdFromTopic(i.channel.topic);
            if (!claimedBy) {
                return i.reply({ content: "❌ This ticket is not claimed.", flags: MessageFlags.Ephemeral });
            }
            const isBypass = config.tickets.claimBypass?.some(roleId => i.member.roles.cache.has(roleId));
            if (claimedBy !== i.user.id && !isBypass) {
                return i.reply({ content: `❌ Only <@${claimedBy}> can unclaim this ticket.`, flags: MessageFlags.Ephemeral });
            }
            await clearClaimedInTopic(i.channel);
            await i.channel.permissionOverwrites.edit(ownerId, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            });
            await i.channel.permissionOverwrites.delete(claimedBy).catch(() => {});
            for (const roleId of config.tickets.claimBypass) {
                await i.channel.permissionOverwrites.edit(roleId, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                });
            }
            const embed = new EmbedBuilder()
                .setDescription(`This ticket has been unclaimed.`)
                .setTimestamp()
                .setColor(config.botColor);
            await i.reply({ embeds: [embed] });
        }

        if (i.customId === "close") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: "❌ You do not have permission to do this!", flags: MessageFlags.Ephemeral });
            }
            if (!i.channel.topic?.toLowerCase().includes("ticket")) {
                return i.reply({ content: "❌ This is not a ticket channel!", flags: MessageFlags.Ephemeral });
            }
            const modal = new ModalBuilder().setCustomId("close-modal-staff").setTitle("Close Reason");
            const reason = new TextInputBuilder()
                .setCustomId("close-reason")
                .setLabel("Close Reason")
                .setPlaceholder("Enter your reason here")
                .setStyle(TextInputStyle.Paragraph);
            modal.addComponents(new ActionRowBuilder().addComponents(reason));
            await i.showModal(modal);
        }

        if (i.customId === "cancel-close-ticket") {
            i.reply({ content: "Ticket will remain open", flags: MessageFlags.Ephemeral });
        }

        if (i.customId === "confirm-close-ticket") {
            const reason = ticketCloseReasons.get(i.channel.id) || "No reason provided";
            await closeTicket({ i, reason, isButton: false });
        }

        if (i.customId.startsWith("namechange-accept-")) {
            const parts = i.customId.replace("namechange-accept-", "").split("-");
            const userId = parts[0];
            const requestedName = parts.slice(1).join("-");
            try {
                const member = await guild.members.fetch(userId);
                await member.setNickname(requestedName);
                try {
                    const user = await client.users.fetch(userId);
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('✅ Name Change Approved')
                        .setDescription(`Your name change request has been approved!`)
                        .addFields(
                            { name: 'New Name', value: requestedName, inline: true },
                            { name: 'Approved By', value: `<@${i.user.id}>`, inline: true }
                        )
                        .setColor('#00FF00')
                        .setTimestamp();
                    await user.send({ embeds: [dmEmbed] });
                } catch (dmError) {
                    console.error('Could not DM user:', dmError);
                }
                const updatedEmbed = EmbedBuilder.from(i.message.embeds[0])
                    .setColor('#00FF00')
                    .addFields({ name: 'Status', value: `✅ Approved by <@${i.user.id}>`, inline: false });
                await i.update({ embeds: [updatedEmbed], components: [] });
            } catch (error) {
                console.error('Error approving name change:', error);
                await i.reply({ content: '❌ There was an error approving the name change.', flags: MessageFlags.Ephemeral });
            }
        }

        if (i.customId.startsWith("namechange-reject-")) {
            const parts = i.customId.replace("namechange-reject-", "").split("-");
            const userId = parts[0];
            try {
                try {
                    const user = await client.users.fetch(userId);
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('❌ Name Change Rejected')
                        .setDescription(`Your name change request has been rejected.`)
                        .addFields({ name: 'Rejected By', value: `<@${i.user.id}>`, inline: true })
                        .setColor('#FF0000')
                        .setTimestamp();
                    await user.send({ embeds: [dmEmbed] });
                } catch (dmError) {
                    console.error('Could not DM user:', dmError);
                }
                const updatedEmbed = EmbedBuilder.from(i.message.embeds[0])
                    .setColor('#FF0000')
                    .addFields({ name: 'Status', value: `❌ Rejected by <@${i.user.id}>`, inline: false });
                await i.update({ embeds: [updatedEmbed], components: [] });
            } catch (error) {
                console.error('Error rejecting name change:', error);
                await i.reply({ content: '❌ There was an error rejecting the name change.', flags: MessageFlags.Ephemeral });
            }
        }

        if (i.customId.startsWith("bug-progress-")) {
            const bugId = i.customId.replace("bug-progress-", "");
            try {
                const connection = await pool.getConnection();
                const [rows] = await connection.query('SELECT user_id, username, title, status FROM bug_reports WHERE bug_id = ?', [bugId]);
                if (rows.length === 0) {
                    await i.reply({ content: '❌ Bug report not found.', flags: MessageFlags.Ephemeral });
                    connection.release();
                    return;
                }
                const bugReport = rows[0];
                if (bugReport.status === 'in_progress') {
                    await i.reply({ content: '⚠️ This bug report is already in progress.', flags: MessageFlags.Ephemeral });
                    connection.release();
                    return;
                }
                await connection.query('UPDATE bug_reports SET status = ?, assigned_to = ?, assigned_by = ? WHERE bug_id = ?', ['in_progress', i.user.id, i.user.id, bugId]);
                connection.release();
                try {
                    const user = await client.users.fetch(bugReport.user_id);
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('🔧 Bug Report In Progress')
                        .setDescription(`A developer is now working on your bug report **${bugReport.title}**!`)
                        .addFields(
                            { name: 'Bug ID', value: bugId, inline: true },
                            { name: 'Developer', value: `<@${i.user.id}>`, inline: true },
                            { name: 'Status', value: 'You will receive updates here', inline: false }
                        )
                        .setColor('#FFA500')
                        .setTimestamp();
                    await user.send({ embeds: [dmEmbed] });
                } catch (dmError) {
                    console.error('Could not DM user:', dmError);
                }
                const originalEmbed = EmbedBuilder.from(i.message.embeds[0])
                    .spliceFields(1, 1, { name: 'Status', value: '🔧 In Progress', inline: true })
                    .addFields({ name: 'Assigned To', value: `<@${i.user.id}>`, inline: true })
                    .setColor('#FFA500');
                await i.update({ embeds: [originalEmbed], components: i.message.components });
            } catch (error) {
                console.error('Error updating bug status:', error);
                await i.reply({ content: '❌ There was an error updating the bug status.', flags: MessageFlags.Ephemeral });
            }
        }

        if (i.customId.startsWith("bug-complete-")) {
            const bugId = i.customId.replace("bug-complete-", "");
            const modal = new ModalBuilder().setCustomId(`bug-complete-reason-${bugId}`).setTitle('Complete Bug Report');
            const reasonInput = new TextInputBuilder()
                .setCustomId('complete-reason')
                .setLabel('Please provide completion details')
                .setPlaceholder('What was done to fix this bug?')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
            await i.showModal(modal);
        }

        if (i.customId.startsWith("bug-reject-")) {
            const bugId = i.customId.replace("bug-reject-", "");
            const modal = new ModalBuilder().setCustomId(`bug-reject-reason-${bugId}`).setTitle('Reject Bug Report');
            const reasonInput = new TextInputBuilder()
                .setCustomId('reject-reason')
                .setLabel('Please provide a rejection reason')
                .setPlaceholder('Why is this bug report being rejected?')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
            await i.showModal(modal);
        }
    }

    if (i.isStringSelectMenu()) {
        if (i.customId === "tickets") {
            const selected = i.values[0];

            const ticketTypes = {
                "general-ticket": {
                    topicPrefix: "General Ticket",
                    category: config.tickets.generalCategory,
                    nameStr: "📋",
                    suffix: "general",
                    title: "General Enquiries Ticket"
                },
                "store-ticket": {
                    topicPrefix: "Store Ticket",
                    category: config.tickets.storeCategory,
                    nameStr: "🏪",
                    suffix: "store",
                    title: "Store Enquiries Ticket"
                },
                "gang-ticket": {
                    topicPrefix: "Gang Ticket",
                    category: config.tickets.gangCategory,
                    nameStr: "🐛",
                    suffix: "bug",
                    title: "Gang Enquiries Ticket"
                },
                "car-ticket": {
                    topicPrefix: "Car Issue Ticket",
                    category: config.tickets.carCategory,
                    nameStr: "🚗",
                    suffix: "car",
                    title: "Car Issue Enquiries Ticket"
                },
                "report-ticket": {
                    topicPrefix: "Report Ticket",
                    category: config.tickets.reportCategory,
                    nameStr: "📝",
                    suffix: "report",
                    title: "Report Enquiries Ticket"
                },
                "management-ticket": {
                    topicPrefix: "Management Ticket",
                    category: config.tickets.managementCategory,
                    nameStr: "👔",
                    suffix: "management",
                    title: "Management Enquiries Ticket"
                }
            };

            if (selected === "staff-ticket") {
                if (!i.member.roles.cache.has(config.staffRole)) {
                    return i.reply({ content: `<@${i.user.id}> You are not a <@&${config.staffRole}>`, flags: MessageFlags.Ephemeral });
                }
                await createTicket({
                    guild, user: i.user, i,
                    name: `✨${i.user.displayName}-staff`,
                    topic: `Staff Ticket - ${i.user.id}`,
                    category: config.tickets.staffCategory,
                    reason: "New Staff Ticket",
                    title: "Staff Made Ticket",
                    staffPing: false
                });
                return;
            }

            const type = ticketTypes[selected];
            if (!type) return;

            const existingTicket = guild.channels.cache.find(
                c => c.topic === `${type.topicPrefix} - ${i.user.id}` && c.parentId === type.category
            );
            if (existingTicket) {
                return i.reply({
                    content: `❌ You already have an open ${type.title.toLowerCase()} ticket: <#${existingTicket.id}>`,
                    flags: MessageFlags.Ephemeral
                });
            }

            await createTicket({
                guild, user: i.user, i,
                name: `${type.nameStr}${i.user.displayName}-${type.suffix}`,
                topic: `${type.topicPrefix} - ${i.user.id}`,
                category: type.category,
                reason: `New ${type.title}`,
                title: type.title
            });
        }
    }

        async function sendImportantLog(embed) {
            try {
                const channel = await client.channels.fetch(config.importantLogs);
                await channel.send({ 
                    content: '@everyone', 
                    embeds: [embed],
                    allowedMentions: { parse: ['everyone'] }
                });
            } catch (error) {
                console.error('Error sending important log:', error);
            }
        }

    if (i.isModalSubmit()) {
        // ── Whitelist reject reason ───────────────────────────────────────────
        if (i.customId.startsWith('wl_reject_reason_')) {
            const applicantId = i.customId.replace('wl_reject_reason_', '');
            const reason = i.fields.getTextInputValue('reject_reason');
            await i.deferUpdate();

            try {
                const connection = await pool.getConnection();
                await connection.query(
                    `UPDATE whitelistApplications SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW() WHERE discord_id = ?`,
                    [i.user.id, applicantId]
                );
                connection.release();

                try {
                    const applicantUser = await client.users.fetch(applicantId);
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('Whitelist Application — Rejected')
                        .setDescription(`Your whitelist application for **Capital Roleplay** has been reviewed and was not successful at this time.\n\n**Reason:** ${reason}`)
                        .setColor('#f87171')
                        .setTimestamp();
                    await applicantUser.send({ embeds: [dmEmbed] });
                } catch { /* DMs disabled */ }

                const rejectedEmbed = new EmbedBuilder()
                    .setTitle('Whitelist Application — Rejected ❌')
                    .setColor('#f87171')
                    .setDescription(`Application rejected by <@${i.user.id}>\n**Reason:** ${reason}`)
                    .setTimestamp();
                await i.editReply({ embeds: [rejectedEmbed], components: [] });
            } catch (error) {
                console.error('Whitelist reject error:', error);
                await i.followUp({ content: '❌ Failed to process rejection.', flags: MessageFlags.Ephemeral });
            }
        }

        if (i.customId === "bug-report") {
            const title = i.fields.getTextInputValue("bug-title");
            const summary = i.fields.getTextInputValue("bug-summary");
            const howToRecreate = i.fields.getTextInputValue("bug-howto");
            const videoLinks = i.fields.getTextInputValue("bug-videolinks") || null;
            const imageLinks = i.fields.getTextInputValue("bug-imagelinks") || null;
            const bugId = `BUG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            try {
                const connection = await pool.getConnection();
                await connection.query(
                    'INSERT INTO bug_reports (bug_id, user_id, username, title, summary, how_to_recreate, video_links, image_links, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [bugId, i.user.id, i.user.tag, title, summary, howToRecreate, videoLinks, imageLinks, 'pending']
                );
                connection.release();
                const bugEmbed = new EmbedBuilder()
                    .setTitle(`🐛 Bug Report: ${title}`)
                    .setDescription(`**Summary:**\n${summary}\n\n**How to Recreate:**\n${howToRecreate}`)
                    .addFields(
                        { name: 'Bug ID', value: bugId, inline: true },
                        { name: 'Status', value: '⏳ Pending', inline: true },
                        { name: 'Reported By', value: `<@${i.user.id}>`, inline: true }
                    )
                    .setColor('#FF0000')
                    .setTimestamp()
                    .setFooter({ text: `Reported by ${i.user.tag}`, iconURL: i.user.displayAvatarURL() });
                if (videoLinks) bugEmbed.addFields({ name: '🎥 Video Links', value: videoLinks, inline: false });
                if (imageLinks) bugEmbed.addFields({ name: '🖼️ Image Links', value: imageLinks, inline: false });
                const buttons = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId(`bug-progress-${bugId}`).setLabel('In Progress').setStyle(ButtonStyle.Primary).setEmoji('🔧'),
                        new ButtonBuilder().setCustomId(`bug-complete-${bugId}`).setLabel('Complete').setStyle(ButtonStyle.Success).setEmoji('✅'),
                        new ButtonBuilder().setCustomId(`bug-reject-${bugId}`).setLabel('Reject').setStyle(ButtonStyle.Danger).setEmoji('❌')
                    );
                const bugChannel = await client.channels.fetch(config.bugReportsChannel);
                const sentMessage = await bugChannel.send({ embeds: [bugEmbed], components: [buttons] });
                const conn = await pool.getConnection();
                await conn.query('UPDATE bug_reports SET message_id = ? WHERE bug_id = ?', [sentMessage.id, bugId]);
                conn.release();
                await i.reply({
                    content: `✅ Your bug report has been submitted successfully!\n\n**Bug ID:** ${bugId}\nYou will be notified of any updates via DM.`,
                    flags: MessageFlags.Ephemeral
                });
            } catch (error) {
                console.error('Error submitting bug report:', error);
                await i.reply({ content: '❌ There was an error submitting your bug report. Please try again later.', flags: MessageFlags.Ephemeral });
            }
        }

        if (i.customId.startsWith("bug-reject-reason-")) {
            const bugId = i.customId.replace("bug-reject-reason-", "");
            const rejectReason = i.fields.getTextInputValue("reject-reason");
            try {
                const connection = await pool.getConnection();
                const [rows] = await connection.query('SELECT user_id, username, title, message_id FROM bug_reports WHERE bug_id = ?', [bugId]);
                if (rows.length === 0) {
                    await i.reply({ content: '❌ Bug report not found.', flags: MessageFlags.Ephemeral });
                    connection.release();
                    return;
                }
                const bugReport = rows[0];
                await connection.query('UPDATE bug_reports SET status = ?, rejected_by = ?, rejection_reason = ? WHERE bug_id = ?', ['rejected', i.user.id, rejectReason, bugId]);
                connection.release();
                try {
                    const user = await client.users.fetch(bugReport.user_id);
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('❌ Bug Report Rejected')
                        .setDescription(`Your bug report **${bugReport.title}** has been rejected.`)
                        .addFields(
                            { name: 'Bug ID', value: bugId, inline: true },
                            { name: 'Rejected By', value: `<@${i.user.id}>`, inline: true },
                            { name: 'Reason', value: rejectReason, inline: false }
                        )
                        .setColor('#FF0000')
                        .setTimestamp();
                    await user.send({ embeds: [dmEmbed] });
                } catch (dmError) {
                    console.error('Could not DM user:', dmError);
                }
                const rejectedChannel = await client.channels.fetch(config.rejectedTasksChannel);
                const rejectedEmbed = new EmbedBuilder()
                    .setTitle(`❌ Bug Report Rejected: ${bugReport.title}`)
                    .setDescription(`**Bug ID:** ${bugId}\n**Rejected By:** <@${i.user.id}>\n**Reason:** ${rejectReason}`)
                    .addFields({ name: 'Originally Reported By', value: `<@${bugReport.user_id}> (${bugReport.username})`, inline: false })
                    .setColor('#FF0000')
                    .setTimestamp();
                await rejectedChannel.send({ embeds: [rejectedEmbed] });
                try {
                    const bugChannel = await client.channels.fetch(config.bugReportsChannel);
                    const originalMessage = await bugChannel.messages.fetch(bugReport.message_id);
                    await originalMessage.delete();
                } catch (deleteError) {
                    console.error('Could not delete original message:', deleteError);
                }
                await i.reply({ content: `✅ Bug report ${bugId} has been rejected and moved to the rejected channel.`, flags: MessageFlags.Ephemeral });
            } catch (error) {
                console.error('Error rejecting bug report:', error);
                await i.reply({ content: '❌ There was an error processing the rejection.', flags: MessageFlags.Ephemeral });
            }
        }

        if (i.customId.startsWith("bug-complete-reason-")) {
            const bugId = i.customId.replace("bug-complete-reason-", "");
            const completeReason = i.fields.getTextInputValue("complete-reason");
            try {
                const connection = await pool.getConnection();
                const [rows] = await connection.query('SELECT user_id, username, title, message_id FROM bug_reports WHERE bug_id = ?', [bugId]);
                if (rows.length === 0) {
                    await i.reply({ content: '❌ Bug report not found.', flags: MessageFlags.Ephemeral });
                    connection.release();
                    return;
                }
                const bugReport = rows[0];
                await connection.query('UPDATE bug_reports SET status = ?, completed_by = ?, completion_reason = ? WHERE bug_id = ?', ['completed', i.user.id, completeReason, bugId]);
                connection.release();
                try {
                    const user = await client.users.fetch(bugReport.user_id);
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('✅ Bug Report Completed')
                        .setDescription(`Your bug report **${bugReport.title}** has been completed!`)
                        .addFields(
                            { name: 'Bug ID', value: bugId, inline: true },
                            { name: 'Completed By', value: `<@${i.user.id}>`, inline: true },
                            { name: 'Details', value: completeReason, inline: false }
                        )
                        .setColor('#00FF00')
                        .setTimestamp();
                    await user.send({ embeds: [dmEmbed] });
                } catch (dmError) {
                    console.error('Could not DM user:', dmError);
                }
                const completedChannel = await client.channels.fetch(config.completedTasksChannel);
                const completedEmbed = new EmbedBuilder()
                    .setTitle(`✅ Bug Report Completed: ${bugReport.title}`)
                    .setDescription(`**Bug ID:** ${bugId}\n**Completed By:** <@${i.user.id}>\n**Details:** ${completeReason}`)
                    .addFields({ name: 'Originally Reported By', value: `<@${bugReport.user_id}> (${bugReport.username})`, inline: false })
                    .setColor('#00FF00')
                    .setTimestamp();
                await completedChannel.send({ embeds: [completedEmbed] });
                try {
                    const bugChannel = await client.channels.fetch(config.bugReportsChannel);
                    const originalMessage = await bugChannel.messages.fetch(bugReport.message_id);
                    await originalMessage.delete();
                } catch (deleteError) {
                    console.error('Could not delete original message:', deleteError);
                }
                await i.reply({ content: `✅ Bug report ${bugId} has been marked as completed and moved to the completed channel.`, flags: MessageFlags.Ephemeral });
            } catch (error) {
                console.error('Error completing bug report:', error);
                await i.reply({ content: '❌ There was an error processing the completion.', flags: MessageFlags.Ephemeral });
            }
        }

        if (i.customId === "dev-update") {
            const description = i.fields.getTextInputValue("descrition");
            const added = i.fields.getTextInputValue("added");
            const removed = i.fields.getTextInputValue("removed");
            const changed = i.fields.getTextInputValue("changed");
            const now = new Date();
            const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
            let desc = description ? `${description}\n\n` : "";
            if (added) {
                const lines = added.split(",").map(l => l.trim()).filter(Boolean);
                desc += `**Added**\n\`\`\`diff\n${lines.map(l => `+ ${l}`).join("\n")}\n\`\`\`\n`;
            }
            if (removed) {
                const lines = removed.split(",").map(l => l.trim()).filter(Boolean);
                desc += `**Removed**\n\`\`\`diff\n${lines.map(l => `- ${l}`).join("\n")}\n\`\`\`\n`;
            }
            if (changed) {
                const lines = changed.split(",").map(l => l.trim()).filter(Boolean);
                desc += `**Changed**\n\`\`\`fix\n${lines.join("\n")}\n\`\`\`\n`;
            }
            const embed = new EmbedBuilder()
                .setTitle(`${dateStr} - City Updates`)
                .setDescription(desc.trim())
                .setColor(config.botColor)
                .setTimestamp();
            const updateChannel = await client.channels.fetch(config.updateChannel);
            await updateChannel.send({ embeds: [embed] });
            await i.reply({ content: "Update posted!", flags: MessageFlags.Ephemeral });
        }

        if (i.customId === "rclose-modal-ticket") {
            const reason = i.fields.getTextInputValue("rclose-reason") || "Not provided";
            await closeTicket({ i, reason, isButton: false });
        }

        if (i.customId === "rclose-modal") {
            const reason = i.fields.getTextInputValue("reason");
            const embed = new EmbedBuilder()
                .setDescription(`<@&${config.staffRole}> user has requested to keep the ticket open`)
                .addFields({ name: "Reason", value: `\`\`\`${reason}\`\`\``, inline: false })
                .setTimestamp()
                .setColor(config.botColor);
            i.reply({ content: `<@&${config.staffRole}>`, embeds: [embed] });
        }

        if (i.customId === "close-modal-staff") {
            const reason = i.fields.getTextInputValue("close-reason") || "Not provided";
            await closeTicket({ i, reason, isButton: false });
        }

        if (i.customId === "suggestion-modal") {
            const suggestion = i.fields.getTextInputValue("suggestion-content");
            const links = i.fields.getTextInputValue("links") || "No links provided";
            const suggestionChannel = await client.channels.fetch(config.suggestionChannel);
            const embed = new EmbedBuilder()
                .setTitle("New Suggestion")
                .setTimestamp()
                .setThumbnail(i.user.displayAvatarURL({ size: 512 }))
                .setColor("#DFC5FE")
                .addFields(
                    { name: "User", value: `<@${i.user.id}>` },
                    { name: "Suggestion", value: `\`\`\`${suggestion}\`\`\``, inline: false },
                    { name: "Links", value: links, inline: false }
                );
            await i.reply({ content: "Your suggestion was successfully submitted!✅", flags: MessageFlags.Ephemeral });
            const message = await suggestionChannel.send({ embeds: [embed] });
            await message.react("✅");
            await message.react("❌");
            await message.startThread({ name: `${i.user.displayName} Suggestion` });
        }
    }

    if (i.isCommand()) {
if (i.commandName === "devlogs") {

        if (!i.member.roles.cache.has(config.developerRole)) {
        return i.reply({ content: "❌ You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    try {
        const connection = await pool.getConnection();

        const [totalResult] = await connection.query('SELECT COUNT(*) as total FROM devCommits');
        const [topDevs] = await connection.query(
            'SELECT user_id, COUNT(*) as total FROM devCommits GROUP BY user_id ORDER BY total DESC LIMIT 3'
        );
        const [topRepos] = await connection.query(
            'SELECT repo, COUNT(*) as total FROM devCommits GROUP BY repo ORDER BY total DESC LIMIT 3'
        );
        const [lastCommit] = await connection.query(
            'SELECT commit_date FROM devCommits ORDER BY commit_date DESC LIMIT 1'
        );

        connection.release();

        const overallStats = `\`\`\`\nTotal Commits:  ${totalResult[0].total}\nLast Commit:    ${lastCommit.length > 0 ? new Date(lastCommit[0].commit_date).toLocaleDateString() : 'N/A'}\n\`\`\``;

        let devList = '';
        if (topDevs.length > 0) {
            topDevs.forEach((row, idx) => {
                const place = ['#1', '#2', '#3'][idx];
                devList += `${place} <@${row.user_id}> — ${row.total} commit${row.total > 1 ? 's' : ''}\n`;
            });
        } else {
            devList = 'No data yet';
        }
        devList += '```';

        let repoList = '```\n';
        if (topRepos.length > 0) {
            topRepos.forEach((row, idx) => {
                const place = ['#1', '#2', '#3'][idx];
                repoList += `${place.padEnd(4)} ${row.repo.padEnd(20)} ${row.total} commit${row.total > 1 ? 's' : ''}\n`;
            });
        } else {
            repoList += 'No data yet\n';
        }
        repoList += '```';

        const guild = await client.guilds.fetch(config.guildId);

        const embed = new EmbedBuilder()
            .setTitle('Development Overview')
            .setThumbnail(guild.iconURL({ size: 512 }))
            .setColor(config.botColor)
            .setTimestamp()
            .setFooter({ text: `Requested by ${i.user.tag}`, iconURL: i.user.displayAvatarURL() })
            .addFields(
                { name: 'Overall Statistics', value: overallStats, inline: false },
                { name: 'Top Developers', value: devList, inline: false },
                { name: 'Most Active Repos', value: repoList, inline: false }
            );

        await i.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error fetching devlogs:', error);
        await i.reply({ content: '❌ Error fetching dev logs.', flags: MessageFlags.Ephemeral });
    }
}
if (i.commandName === "commitstats") {
    if (!i.member.roles.cache.has(config.developerRole)) {
        return i.reply({ content: "You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const targetUser = i.options.getUser("user");
    const days = i.options.getNumber("days");
    const dateFilter = days ? ' AND commit_date >= DATE_SUB(NOW(), INTERVAL ? DAY)' : '';
    const dateLabel = days ? ` — Last ${days} Days` : ' — All Time';

    try {
        const connection = await pool.getConnection();

        if (targetUser) {
            const [commits] = await connection.query(
                `SELECT repo, COUNT(*) as count FROM devCommits WHERE user_id = ?${dateFilter} GROUP BY repo ORDER BY count DESC`,
                days ? [targetUser.id, days] : [targetUser.id]
            );
            const [total] = await connection.query(
                `SELECT COUNT(*) as total, MAX(commit_date) as last_commit FROM devCommits WHERE user_id = ?${dateFilter}`,
                days ? [targetUser.id, days] : [targetUser.id]
            );
            connection.release();

            if (commits.length === 0) {
                return i.reply({ content: `No commits found for <@${targetUser.id}>${dateLabel}.`, flags: MessageFlags.Ephemeral });
            }

            const overallStats = `\`\`\`\nTotal Commits:  ${total[0].total}\nLast Commit:    ${new Date(total[0].last_commit).toLocaleDateString()}\n\`\`\``;

            let repoBreakdown = '```\n';
            commits.forEach(r => {
                repoBreakdown += `${r.repo.padEnd(20)} ${r.count} commit${r.count > 1 ? 's' : ''}\n`;
            });
            repoBreakdown += '```';

            const embed = new EmbedBuilder()
                .setTitle(`Commit Stats — ${targetUser.username}${dateLabel}`)
                .setThumbnail(targetUser.displayAvatarURL({ size: 512 }))
                .setColor(config.botColor)
                .setTimestamp()
                .setFooter({ text: `Requested by ${i.user.tag}`, iconURL: i.user.displayAvatarURL() })
                .addFields(
                    { name: 'Overall Statistics', value: overallStats, inline: false },
                    { name: 'Breakdown by Repo', value: repoBreakdown, inline: false }
                );

            await i.reply({ embeds: [embed] });
        } else {
            const [leaderboard] = await connection.query(
                `SELECT user_id, COUNT(*) as total FROM devCommits WHERE 1=1${dateFilter} GROUP BY user_id ORDER BY total DESC`,
                days ? [days] : []
            );
            connection.release();

            if (leaderboard.length === 0) {
                return i.reply({ content: `No commits recorded${dateLabel}.`, flags: MessageFlags.Ephemeral });
            }

            let list = '```\n';
            leaderboard.forEach((row, index) => {
                list += `#${String(index + 1).padEnd(3)} <@${row.user_id}> — ${row.total} commit${row.total > 1 ? 's' : ''}\n`;
            });
            list += '```';

            const embed = new EmbedBuilder()
                .setTitle(`Commit Leaderboard${dateLabel}`)
                .setColor(config.botColor)
                .setTimestamp()
                .setFooter({ text: `Requested by ${i.user.tag}`, iconURL: i.user.displayAvatarURL() })
                .addFields(
                    { name: 'Rankings', value: list, inline: false }
                );

            await i.reply({ embeds: [embed] });
        }
    } catch (error) {
        console.error('Error fetching commit stats:', error);
        await i.reply({ content: 'Error fetching commit stats.', flags: MessageFlags.Ephemeral });
    }
}
if (i.commandName === "pull") {
    if (!i.member.roles.cache.has(config.headDeveloper)) {
        return i.reply({ content: "❌ You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const repo = i.options.getString("repo");
    await i.deferReply();

    try {
        const encodedSecret = encodeURIComponent(config.pullServerSecret);

        const [hashRes, filesRes, commitsRes] = await Promise.all([
            axios.get(`${config.pullServerUrl}/current-hash?repo=${repo}&secret=${encodedSecret}`),
            axios.get(`${config.pullServerUrl}/unpulled-files?repo=${repo}&secret=${encodedSecret}`),
            axios.get(`https://api.github.com/repos/${config.githubOrg}/${repo}/commits?per_page=20`, {
                headers: { Authorization: `Bearer ${config.githubPAT}`, Accept: "application/vnd.github+json" }
            })
        ]);

        const localHash = hashRes.data.hash;
        const changedFiles = filesRes.data.files;

        const allCommits = commitsRes.data;
        const localIndex = allCommits.findIndex(c => c.sha === localHash);
        const unpulledCommits = localIndex === -1 ? allCommits : allCommits.slice(0, localIndex);

        if (unpulledCommits.length === 0 && changedFiles.length === 0) {
            return i.editReply({ content: `✅ **${repo}** is already up to date.` });
        }

        const commitList = unpulledCommits.map(c => {
            const title = c.commit.message.split('\n')[0];
            const desc = c.commit.message.split('\n').slice(2).join('\n').trim();
            return `\`${c.sha.slice(0, 7)}\` **${title}** — ${c.commit.author.name}${desc ? `\n> ${desc}` : ''}`;
        }).join('\n\n');

        const fileList = changedFiles.length > 0
            ? changedFiles.map(f => `• \`${f}\``).join('\n')
            : 'None';

        const truncatedCommits = commitList.length > 900 ? commitList.slice(0, 900) + '...' : commitList;
        const truncatedFiles = fileList.length > 900 ? fileList.slice(0, 900) + '...' : fileList;

        const embed = new EmbedBuilder()
            .setTitle(`Pull — ${repo}`)
            .setColor(config.botColor)
            .setTimestamp()
            .setFooter({ text: `Requested by ${i.user.tag}`, iconURL: i.user.displayAvatarURL() })
            .addFields(
                { name: `Unpulled Commits (${unpulledCommits.length})`, value: truncatedCommits || 'None', inline: false },
                { name: 'Files Changed', value: truncatedFiles || 'None', inline: false }
            )

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`pull_confirm_${repo}`)
                .setLabel('Pull')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`pull_cancel_${repo}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Danger)
        );

        await i.editReply({ embeds: [embed], components: [row] });

    } catch (error) {
        console.error('Error fetching pull info:', error);
        await i.editReply({ content: `❌ Failed to fetch commits. ${error.message}` });
    }
}


if (i.commandName === "removecollab") {
    if (!i.member.roles.cache.has(config.headDeveloper)) {
        return i.reply({ content: "❌ You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const githubUsername = i.options.getString("githubusername");
    const repo = i.options.getString("repo");

    await i.deferReply();

    const allRepos = ["CRScripts", "CRVehicles", "CRStandalone", "CRCore", "CRCustom", "CRWeapons", "CRMlo", "CRClothing", "CRDependencies", "CROx"];
    const reposToRemove = repo === "all" ? allRepos : [repo];

    const removed = [];
    const failed = [];

    for (const r of reposToRemove) {
        try {
            await axios.delete(
                `https://api.github.com/repos/${config.githubOrg}/${r}/collaborators/${githubUsername}`,
                {
                    headers: {
                        Authorization: `Bearer ${config.githubPAT}`,
                        Accept: "application/vnd.github+json"
                    }
                }
            );
            removed.push(r);
        } catch (error) {
            failed.push(r);
        }
    }

    const embed = new EmbedBuilder()
        .setTitle("🚫 Collaborator Removed")
        .setColor("Red")
        .addFields(
            { name: "GitHub", value: githubUsername, inline: true },
            { name: "Removed By", value: `<@${i.user.id}>`, inline: true },
            { name: "Removed From", value: removed.length > 0 ? removed.join(', ') : 'None', inline: false }
        )
        .setTimestamp();

    if (failed.length > 0) {
        embed.addFields({ name: "Not Found In", value: failed.join(', '), inline: false });
    }

    await i.editReply({ embeds: [embed] });
    await sendImportantLog(embed);
}
if (i.commandName === "addcollab") {
    if (!i.member.roles.cache.has(config.headDeveloper)) {
        return i.reply({ content: "❌ You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const user = i.options.getUser("user");
    const githubUsername = i.options.getString("githubusername");
    const repo = i.options.getString("repo");

    try {
        await axios.put(
            `https://api.github.com/repos/${config.githubOrg}/${repo}/collaborators/${githubUsername}`,
            { permission: "push" },
            {
                headers: {
                    Authorization: `Bearer ${config.githubPAT}`,
                    Accept: "application/vnd.github+json"
                }
            }
        );

        const embed = new EmbedBuilder()
            .setTitle("✅ Collaborator Added")
            .setColor(config.botColor)
            .addFields(
                { name: "Discord", value: `<@${user.id}>`, inline: true },
                { name: "GitHub", value: githubUsername, inline: true },
                { name: "Repo", value: `[${repo}](https://github.com/${config.githubOrg}/${repo})`, inline: true },
                { name: "Added By", value: `<@${i.user.id}>`, inline: true }
            )
            .setTimestamp();

        await i.reply({ embeds: [embed] });
        await sendImportantLog(embed);
    } catch (error) {
        console.error("Error adding collaborator:", error?.response?.data || error);
        await i.reply({ content: `❌ Failed to add collaborator. Make sure the GitHub username \`${githubUsername}\` is correct.`, flags: MessageFlags.Ephemeral });
    }
}
        if (i.commandName === "showdevs") {

                if (!i.member.roles.cache.has(config.headDeveloper)) {
                    return i.reply({ content: "❌ You don't have permission to use this.", flags: MessageFlags.Ephemeral });
                }


            try {
                const connection = await pool.getConnection();
                const [devRows] = await connection.query('SELECT user_id, github_username FROM githubDevs');
                connection.release();

                if (devRows.length === 0) {
                    return i.reply({ content: '❌ No developers linked yet.', flags: MessageFlags.Ephemeral });
                }

                const devList = devRows.map(row => `<@${row.user_id}> — \`${row.github_username}\``).join('\n');

                const embed = new EmbedBuilder()
                    .setTitle('👨‍💻 Linked Developers')
                    .setDescription(devList)
                    .setColor(config.botColor)
                    .setTimestamp();

                await i.reply({ embeds: [embed] });
            } catch (error) {
                console.error('Error fetching devs:', error);
                await i.reply({ content: '❌ Error fetching developers.', flags: MessageFlags.Ephemeral });
            }
        }
if (i.commandName === "adddev") {
    if (!i.member.roles.cache.has(config.headDeveloper)) {
        return i.reply({ content: "❌ You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }
    const user = i.options.getUser("user");
    const githubUsername = i.options.getString("githubusername").toLowerCase();
    try {
        const connection = await pool.getConnection();
        await connection.query(
            'INSERT INTO githubDevs (user_id, github_username) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = ?',
            [user.id, githubUsername, user.id]
        );
        connection.release();

        const embed = new EmbedBuilder()
            .setTitle('✅ Dev Linked')
            .addFields(
                { name: 'Discord', value: `<@${user.id}>`, inline: true },
                { name: 'GitHub', value: githubUsername, inline: true },
                { name: 'Added By', value: `<@${i.user.id}>`, inline: true }
            )
            .setColor(config.botColor)
            .setTimestamp();

        await i.reply({ embeds: [embed] });
        await sendImportantLog(embed);
    } catch (error) {
        console.error('Error linking dev:', error);
        await i.reply({ content: '❌ Error linking dev.', flags: MessageFlags.Ephemeral });
    }
}
if (i.commandName === "showcollabs") {
    if (!i.member.roles.cache.has(config.headDeveloper)) {
        return i.reply({ content: "❌ You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }

    const repo = i.options.getString("repo");

    await i.deferReply();

    try {
        const response = await axios.get(
            `https://api.github.com/repos/${config.githubOrg}/${repo}/collaborators`,
            {
                headers: {
                    Authorization: `Bearer ${config.githubPAT}`,
                    Accept: "application/vnd.github+json"
                }
            }
        );

        const collabs = response.data;

        if (collabs.length === 0) {
            return i.editReply({ content: `❌ No collaborators found for **${repo}**.` });
        }

        const collabList = collabs.map(c => `• \`${c.login}\``).join('\n');

        const embed = new EmbedBuilder()
            .setTitle(`👥 Collaborators — ${repo}`)
            .setDescription(collabList)
            .setColor(config.botColor)
            .setFooter({ text: `${collabs.length} collaborator(s)` })
            .setTimestamp();

        await i.editReply({ embeds: [embed] });
    } catch (error) {
        console.error("Error fetching collaborators:", error?.response?.data || error);
        await i.editReply({ content: `❌ Failed to fetch collaborators for **${repo}**.` });
    }
}
if (i.commandName === "removedev") {
    if (!i.member.roles.cache.has(config.headDeveloper)) {
        return i.reply({ content: "❌ You don't have permission to use this.", flags: MessageFlags.Ephemeral });
    }
    const user = i.options.getUser("user");
    try {
        const connection = await pool.getConnection();
        await connection.query('DELETE FROM githubDevs WHERE user_id = ?', [user.id]);
        connection.release();

        const embed = new EmbedBuilder()
            .setTitle('🚫 Dev Unlinked')
            .addFields(
                { name: 'Discord', value: `<@${user.id}>`, inline: true },
                { name: 'Removed By', value: `<@${i.user.id}>`, inline: true }
            )
            .setColor("Red")
            .setTimestamp();

        await i.reply({ content: `✅ Removed GitHub link for <@${user.id}>`, embeds: [embed], flags: MessageFlags.Ephemeral });
        await sendImportantLog(embed);
    } catch (error) {
        console.error('Error removing dev:', error);
        await i.reply({ content: '❌ Error removing dev.', flags: MessageFlags.Ephemeral });
    }
}
       if (i.commandName === "verify-message") {
            const verifyChannel = await client.channels.fetch(config.verifyChannel);
            const embed = new EmbedBuilder()
                .setTitle("Capital RP | Verification ✅")
                .setDescription("Please click ✅ to verify and gain access to our discord")
                .setColor(config.botColor)
                .setTimestamp()

            const message = await verifyChannel.send({ embeds: [embed] })
            await message.react("✅")

            const connection = await pool.getConnection()
            await connection.query(
                "INSERT INTO bot_config (`key`, `value`) VALUES ('verifyMessageId', ?) ON DUPLICATE KEY UPDATE `value` = ?",
                [message.id, message.id]
            )
            connection.release()

            client.verifyMessageId = message.id

            await i.reply({
                content: "Embed successfully sent! ✅",
                flags: MessageFlags.Ephemeral
            })
        }
        if (i.commandName === "info") {
            const embed = new EmbedBuilder()
                .setTitle("Capital RP - Bot Commands")
                .setDescription("Here are all available commands:")
                .addFields(
                    { name: "/mention <user>", value: "Mention a user", inline: false },
                    { name: "/links", value: "Shows list of relevant links for staff/developers", inline: false },
                    { name: "/add-streamer <user> <twitch-url>", value: "Add a streamer to track for live notifications", inline: false },
                    { name: "/remove-streamer <user>", value: "Remove a tracked streamer", inline: false },
                    { name: "/name-change-message", value: "Post name change message info", inline: false },
                    { name: "/namechange <name>", value: "Request a discord name change", inline: false },
                    { name: "/update", value: "Create a new development update", inline: false },
                    { name: "/bugreport", value: "Report a bug to our development team", inline: false },
                    { name: "/bug-stats", value: "View bug report statistics and developer leaderboard", inline: false },
                    { name: "/suggestion", value: "Create a suggestion", inline: false },
                    { name: "/purge <amount>", value: "Delete a certain amount of messages (max 100)", inline: false },
                    { name: "/close", value: "Close the ticket you are in", inline: false },
                    { name: "/rclose", value: "Request ticket closure", inline: false },
                    { name: "/sub", value: "Get notified when messages are sent in this ticket", inline: false },
                    { name: "/unsub", value: "Remove a channel subscription", inline: false },
                    { name: "/add <user/role>", value: "Add a user or role to this ticket", inline: false },
                    { name: "/remove <user/role>", value: "Remove a user or role from this ticket", inline: false },
                    { name: "/move <category>", value: "Move this channel to another category", inline: false },
                    { name: "/transfer <user>", value: "Transfer ticket ownership to another user", inline: false },
                    { name: "/ticket-stats [days]", value: "View ticket statistics", inline: false },
                    { name: "/remind <user> <hours> <reminder>", value: "Set a reminder for a user", inline: false },
                    { name: "/server-info", value: "View server information", inline: false },
                    { name: "/ping <user>", value: "Ping a user", inline: false },
                    { name: "/paypal <user> <amount>", value: "Send PayPal payment details", inline: false }
                )
                .setColor(0x5865F2)
                .setTimestamp();
            await i.reply({ embeds: [embed], ephemeral: true });
        }

        if (i.commandName === "add-streamer") {
            if (!i.member.roles.cache.has(config.developerRole)) {
                return i.reply({ content: `<@${i.user.id}> You don't have permission to use this.`, flags: MessageFlags.Ephemeral });
            }
            const user = i.options.getUser("user");
            const twitchUrl = i.options.getString("twitch-url");
            const twitchUsername = twitchUrl.split('/').pop().toLowerCase();
            try {
                const connection = await pool.getConnection();
                const [existing] = await connection.query('SELECT * FROM twitchStreamers WHERE user_id = ?', [user.id]);
                if (existing.length > 0) {
                    await i.reply({ content: `❌ <@${user.id}> is already registered as a streamer!`, flags: MessageFlags.Ephemeral });
                    connection.release();
                    return;
                }
                await connection.query('INSERT INTO twitchStreamers (user_id, username, twitch_username, twitch_url) VALUES (?, ?, ?, ?)', [user.id, user.tag, twitchUsername, twitchUrl]);
                connection.release();
                const embed = new EmbedBuilder()
                    .setTitle('✅ Streamer Added')
                    .setDescription(`Successfully added <@${user.id}> as a tracked streamer!`)
                    .addFields(
                        { name: 'Discord User', value: `<@${user.id}>`, inline: true },
                        { name: 'Twitch', value: `[${twitchUsername}](${twitchUrl})`, inline: true }
                    )
                    .setColor('#00FF00')
                    .setTimestamp();
                await i.reply({ embeds: [embed] });
            } catch (error) {
                console.error('Error adding streamer:', error);
                await i.reply({ content: '❌ There was an error adding the streamer.', flags: MessageFlags.Ephemeral });
            }
        }

        if (i.commandName === "remove-streamer") {
            if (!i.member.roles.cache.has(config.developerRole)) {
                return i.reply({ content: `<@${i.user.id}> You don't have permission to use this.`, flags: MessageFlags.Ephemeral });
            }
            const user = i.options.getUser("user");
            try {
                const connection = await pool.getConnection();
                const [existing] = await connection.query('SELECT * FROM twitchStreamers WHERE user_id = ?', [user.id]);
                if (existing.length === 0) {
                    await i.reply({ content: `❌ <@${user.id}> is not registered as a streamer!`, flags: MessageFlags.Ephemeral });
                    connection.release();
                    return;
                }
                await connection.query('DELETE FROM twitchStreamers WHERE user_id = ?', [user.id]);
                connection.release();
                streamersOnline.delete(user.id);
                const embed = new EmbedBuilder()
                    .setTitle('✅ Streamer Removed')
                    .setDescription(`Successfully removed <@${user.id}> from tracked streamers!`)
                    .setColor('#FF0000')
                    .setTimestamp();
                await i.reply({ embeds: [embed] });
            } catch (error) {
                console.error('Error removing streamer:', error);
                await i.reply({ content: '❌ There was an error removing the streamer.', flags: MessageFlags.Ephemeral });
            }
        }

        if (i.commandName === "links") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: `<@${i.user.id}> You don't have permission to use this.`, flags: MessageFlags.Ephemeral });
            }
            const embed = new EmbedBuilder()
                .setTitle("Capital RP - Relevant Links")
                .setDescription(
                    `[Cosmo](https://app.cosmo.ci/)\n` +
                    `[TX-Main](http://city.9krp.com:40120/)\n` +
                    `[TX-Dev](http://construction.9krp.com:40120/)`
                )
                .setColor(0x5865F2);
            await i.reply({ embeds: [embed], ephemeral: true });
        }

        if (i.commandName === "name-change-message") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: `<@${i.user.id}> You don't have permission to use this.`, flags: MessageFlags.Ephemeral });
            }
            try {
                const nameMessage = new EmbedBuilder()
                    .setTitle('📝 Name Change Request')
                    .setDescription(`To change your name in the discord please use the command **/namechange (name)** and a member of our staff team will approve your name request`)
                    .setColor('#FFA500');
                const namechangeChannel = await client.channels.fetch(config.nameChangeChannel);
                await namechangeChannel.send({ embeds: [nameMessage] });
                await i.reply({ content: '✅ Name change message has been sent!', flags: MessageFlags.Ephemeral });
            } catch (error) {
                console.error('Error sending name change message:', error);
                await i.reply({ content: '❌ There was an error sending the message.', flags: MessageFlags.Ephemeral });
            }
        }

        if (i.commandName === "namechange") {
            const requestedName = i.options.getString("name");
            try {
                const nameRequestEmbed = new EmbedBuilder()
                    .setTitle('📝 Name Change Request')
                    .setDescription(`A user has requested a name change.`)
                    .addFields(
                        { name: 'User', value: `<@${i.user.id}>`, inline: true },
                        { name: 'Current Name', value: i.member.displayName, inline: true },
                        { name: 'Requested Name', value: requestedName, inline: false }
                    )
                    .setColor('#FFA500')
                    .setTimestamp()
                    .setFooter({ text: `Requested by ${i.user.tag}`, iconURL: i.user.displayAvatarURL() });
                const buttons = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId(`namechange-accept-${i.user.id}-${requestedName}`).setLabel('Accept').setStyle(ButtonStyle.Success).setEmoji('✅'),
                        new ButtonBuilder().setCustomId(`namechange-reject-${i.user.id}-${requestedName}`).setLabel('Reject').setStyle(ButtonStyle.Danger).setEmoji('❌')
                    );
                const nameRequestChannel = await client.channels.fetch(config.nameRequests);
                await nameRequestChannel.send({ embeds: [nameRequestEmbed], components: [buttons] });
                await i.reply({ content: '✅ Your name change request has been submitted and is pending approval.', flags: MessageFlags.Ephemeral });
            } catch (error) {
                console.error('Error submitting name change request:', error);
                await i.reply({ content: '❌ There was an error submitting your name change request.', flags: MessageFlags.Ephemeral });
            }
        }

        if (i.commandName === "update") {
            if (!i.member.roles.cache.has(config.developerRole)) {
                return i.reply({ content: `<@${i.user.id}> You are not a <@&${config.developerRole}>`, flags: MessageFlags.Ephemeral });
            }
            const modal = new ModalBuilder().setCustomId("dev-update").setTitle(`${config.serverName} - Dev Update`);
            const description = new TextInputBuilder().setCustomId("descrition").setLabel("Enter a description").setPlaceholder("Enter description here").setStyle(TextInputStyle.Short).setRequired(false);
            const added = new TextInputBuilder().setCustomId("added").setLabel("What has been added").setPlaceholder("Comma separate for multiple").setStyle(TextInputStyle.Paragraph).setRequired(false);
            const removed = new TextInputBuilder().setCustomId("removed").setLabel("What has been removed").setPlaceholder("Comma separate for multiple").setStyle(TextInputStyle.Paragraph).setRequired(false);
            const changed = new TextInputBuilder().setCustomId("changed").setLabel("What has been changed").setPlaceholder("Comma separate for multiple").setStyle(TextInputStyle.Paragraph).setRequired(false);
            modal.addComponents(
                new ActionRowBuilder().addComponents(description),
                new ActionRowBuilder().addComponents(added),
                new ActionRowBuilder().addComponents(removed),
                new ActionRowBuilder().addComponents(changed)
            );
            await i.showModal(modal);
        }

        if (i.commandName === "bugreport") {
            const modal = new ModalBuilder().setCustomId("bug-report").setTitle(`${config.serverName} - Bug Report`);
            const bugTitle = new TextInputBuilder().setCustomId("bug-title").setLabel("Enter in a Title for this bug").setPlaceholder("In a short Title what is the bug?").setStyle(TextInputStyle.Short);
            const bugSummary = new TextInputBuilder().setCustomId("bug-summary").setLabel("Explain the bug as detailed as you can").setPlaceholder("What is the bug you are reporting?").setStyle(TextInputStyle.Paragraph);
            const bugHowToCreate = new TextInputBuilder().setCustomId("bug-howto").setLabel("How can we re-create this bug?").setPlaceholder("Explain how our dev team can re-create this issue").setStyle(TextInputStyle.Paragraph);
            const bugVideoLinks = new TextInputBuilder().setCustomId("bug-videolinks").setLabel("Video Links").setPlaceholder("Provide us with link to video illustrating the bug").setStyle(TextInputStyle.Short).setRequired(false);
            const bugImageLinks = new TextInputBuilder().setCustomId("bug-imagelinks").setLabel("Image Links").setPlaceholder("Paste in image links that shows the issue").setStyle(TextInputStyle.Short).setRequired(false);
            modal.addComponents(
                new ActionRowBuilder().addComponents(bugTitle),
                new ActionRowBuilder().addComponents(bugSummary),
                new ActionRowBuilder().addComponents(bugHowToCreate),
                new ActionRowBuilder().addComponents(bugVideoLinks),
                new ActionRowBuilder().addComponents(bugImageLinks)
            );
            await i.showModal(modal);
        }

        if (i.commandName === "bug-stats") {
            try {
                const connection = await pool.getConnection();
                const [stats] = await connection.query(`
                    SELECT 
                        COUNT(*) as total_bugs,
                        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_bugs,
                        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_bugs,
                        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_bugs,
                        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_bugs
                    FROM bug_reports
                `);
                const statsData = stats[0];
                const openBugs = (statsData.pending_bugs || 0) + (statsData.in_progress_bugs || 0);
                const [devStats] = await connection.query(`
                    SELECT completed_by, COUNT(*) as completed_count
                    FROM bug_reports
                    WHERE completed_by IS NOT NULL
                    GROUP BY completed_by
                    ORDER BY completed_count DESC
                `);
                connection.release();
                const overallStats = `\`\`\`\nTotal Bugs Reported: ${statsData.total_bugs || 0}\nOpen Bugs:           ${openBugs}\n\`\`\``;
                const statusBreakdown = `\`\`\`\nPending:      ${statsData.pending_bugs || 0}\nIn Progress:  ${statsData.in_progress_bugs || 0}\nCompleted:    ${statsData.completed_bugs || 0}\nRejected:     ${statsData.rejected_bugs || 0}\n\`\`\``;
                const statsEmbed = new EmbedBuilder()
                    .setTitle('Bug Report Statistics')
                    .setColor('#0099ff')
                    .setTimestamp()
                    .setFooter({ text: `Requested by ${i.user.tag}`, iconURL: i.user.displayAvatarURL() })
                    .addFields(
                        { name: 'Overall Statistics', value: overallStats, inline: false },
                        { name: 'Status Breakdown', value: statusBreakdown, inline: false }
                    );
                if (devStats.length > 0) {
                    let devLeaderboard = '';
                    for (let idx = 0; idx < Math.min(devStats.length, 10); idx++) {
                        const dev = devStats[idx];
                        devLeaderboard += `**#${idx + 1}** <@${dev.completed_by}> - ${dev.completed_count} bug${dev.completed_count > 1 ? 's' : ''} fixed\n`;
                    }
                    statsEmbed.addFields({ name: 'Top Developers', value: devLeaderboard.trim(), inline: false });
                } else {
                    statsEmbed.addFields({ name: 'Top Developers', value: 'No bugs have been completed yet.', inline: false });
                }
                await i.reply({ embeds: [statsEmbed] });
            } catch (error) {
                console.error('Error fetching bug stats:', error);
                await i.reply({ content: 'There was an error fetching bug statistics. Please try again later.', flags: MessageFlags.Ephemeral });
            }
        }

        if (i.commandName === "suggestion") {
            const modal = new ModalBuilder().setCustomId("suggestion-modal").setTitle("Suggestion");
            const suggestion = new TextInputBuilder().setCustomId("suggestion-content").setLabel("Suggestion").setPlaceholder("Enter your suggestion here").setStyle(TextInputStyle.Paragraph);
            const link = new TextInputBuilder().setCustomId("links").setLabel("Links").setPlaceholder("Enter any link here").setStyle(TextInputStyle.Short).setRequired(false);
            modal.addComponents(
                new ActionRowBuilder().addComponents(suggestion),
                new ActionRowBuilder().addComponents(link)
            );
            await i.showModal(modal);
        }

        if (i.commandName === "purge") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: `<@${i.user.id}> You are not a <@&${config.staffRole}>`, flags: MessageFlags.Ephemeral });
            }
            const amount = i.options.getNumber("amount");
            const channel = i.channel;
            const logChannel = await client.channels.fetch(config.channelIdLogs);
            let totalDeleted = 0;
            while (totalDeleted < amount) {
                const toFetch = Math.min(100, amount - totalDeleted);
                const fetched = await channel.messages.fetch({ limit: toFetch });
                if (fetched.size === 0) break;
                const deleted = await channel.bulkDelete(fetched, true);
                totalDeleted += deleted.size;
                if (deleted.size < fetched.size) break;
            }
            const embed = new EmbedBuilder()
                .setTitle("Channel was purged!")
                .setTimestamp()
                .setColor("Red")
                .setThumbnail(i.user.displayAvatarURL())
                .addFields(
                    { name: "Admin", value: `<@${i.user.id}>`, inline: false },
                    { name: "Channel", value: `<#${channel.id}>`, inline: false },
                    { name: "Messages", value: `${amount}`, inline: false }
                );
            await logChannel.send({ embeds: [embed] });
            await i.reply({ content: `<@${i.user.id}> you deleted ${amount} messages!`, flags: MessageFlags.Ephemeral });
        }

        if (i.commandName === "close") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: "❌ You do not have permission to do this!", flags: MessageFlags.Ephemeral });
            }
            if (!i.channel.topic?.toLowerCase().includes("ticket")) {
                return i.reply({ content: "❌ This is not a ticket channel!", flags: MessageFlags.Ephemeral });
            }
            const modal = new ModalBuilder().setCustomId("close-modal-staff").setTitle("Close Reason");
            const reason = new TextInputBuilder().setCustomId("close-reason").setLabel("Close Reason").setPlaceholder("Enter your reason here").setStyle(TextInputStyle.Paragraph);
            modal.addComponents(new ActionRowBuilder().addComponents(reason));
            await i.showModal(modal);
        }

        if (i.commandName === "rclose") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: "❌ You do not have permission to do this!", flags: MessageFlags.Ephemeral });
            }
            if (!i.channel.topic?.toLowerCase().includes("ticket")) {
                return i.reply({ content: "❌ This is not a ticket channel!", flags: MessageFlags.Ephemeral });
            }
            const userId = i.channel.topic?.split(' - ')[1];
            const embed = new EmbedBuilder()
                .setDescription(`Hey! <@${userId}>, support have indicated that the ticket is now resolved. Would you like to close the ticket or do you have further questions?`)
                .setTimestamp()
                .setColor(config.botColor);
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId("rclose-btn").setLabel("Close").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("rclose-cancel-btn").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
                );
            await i.reply({ content: `<@${userId}>`, embeds: [embed], components: [row] });
        }

        if (i.commandName === "ticket-stats") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: "❌ You do not have permission to do this!", flags: MessageFlags.Ephemeral });
            }
            const days = i.options.getNumber("days");
            const generalTickets = guild.channels.cache.filter(c => c.parentId === config.tickets.generalCategory && c.type === ChannelType.GuildText).size;
            const storeTickets = guild.channels.cache.filter(c => c.parentId === config.tickets.storeCategory && c.type === ChannelType.GuildText).size;
            const gangTickets = guild.channels.cache.filter(c => c.parentId === config.tickets.gangCategory && c.type === ChannelType.GuildText).size;
            const carTickets = guild.channels.cache.filter(c => c.parentId === config.tickets.carCategory && c.type === ChannelType.GuildText).size;
            const reportTickets = guild.channels.cache.filter(c => c.parentId === config.tickets.reportCategory && c.type === ChannelType.GuildText).size;
            const managementTickets = guild.channels.cache.filter(c => c.parentId === config.tickets.managementCategory && c.type === ChannelType.GuildText).size;
            const totalOpenTickets = generalTickets + storeTickets + gangTickets + carTickets + reportTickets + managementTickets;
            const dbStats = await getTicketStats(days);
            const embed = new EmbedBuilder()
                .setTitle(`🎫 Ticket Statistics${days ? ` (Last ${days} Days)` : ' (All Time)'}`)
                .setColor(config.botColor)
                .setThumbnail(guild.iconURL({ size: 512, dynamic: true }))
                .setTimestamp()
                .setDescription(
                    `**Overall Statistics**\n**Total Tickets Closed:** ${dbStats.totalClosed}\n**Open Tickets:** ${totalOpenTickets}\n\n` +
                    `**Category Breakdown**\n**General:** ${generalTickets}\n**Store:** ${storeTickets}\n**Gang:** ${gangTickets}\n**Car Issue:** ${carTickets}\n**Report:** ${reportTickets}\n**Management:** ${managementTickets}`
                );
            if (dbStats.staffStats.length > 0) {
                const staffLeaderboard = dbStats.staffStats.slice(0, 10).map((staff, index) => {
                    const pos = index === 0 ? '#1' : index === 1 ? '#2' : index === 2 ? '#3' : `#${index + 1}`;
                    return `${pos} <@${staff.staff_id}> - ${staff.tickets_closed} tickets closed`;
                }).join('\n');
                embed.addFields({ name: "Top Staff Members", value: staffLeaderboard || "No data available", inline: false });
            }
            await i.reply({ embeds: [embed] });
        }

        if (i.commandName === "sub") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: "❌ You do not have permission to do this!", flags: MessageFlags.Ephemeral });
            }
            if (!i.channel.topic?.toLowerCase().includes("ticket")) {
                return i.reply({ content: "❌ This is not a ticket channel!", flags: MessageFlags.Ephemeral });
            }
            if (!ticketSubscriptions.has(i.channel.id)) {
                ticketSubscriptions.set(i.channel.id, new Set());
            }
            const subs = ticketSubscriptions.get(i.channel.id);
            if (subs.has(i.user.id)) {
                const embed = new EmbedBuilder().setTitle(`<@${i.user.id}> You are already subscribed to this channel`).setTimestamp().setColor(config.botColor);
                return i.reply({ embeds: [embed] });
            }
            subs.add(i.user.id);
            const embed = new EmbedBuilder()
                .setTitle("Ticket Sub")
                .setDescription(`<@${i.user.id}> will now be notified of all messages received.`)
                .setTimestamp()
                .setColor(config.botColor);
            await i.reply({ embeds: [embed] });
        }

        if (i.commandName === "unsub") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: "❌ You do not have permission to do this!", flags: MessageFlags.Ephemeral });
            }
            if (!i.channel.topic?.toLowerCase().includes("ticket")) {
                return i.reply({ content: "❌ This is not a ticket channel!", flags: MessageFlags.Ephemeral });
            }
            const subs = ticketSubscriptions.get(i.channel.id);
            if (!subs || !subs.has(i.user.id)) {
                const embed = new EmbedBuilder().setTitle("Ticket Sub").setDescription(`<@${i.user.id}> You are not subscribed to this ticket`).setTimestamp().setColor(config.botColor);
                return i.reply({ embeds: [embed] });
            }
            subs.delete(i.user.id);
            const embed = new EmbedBuilder().setTitle("Ticket Sub").setDescription(`<@${i.user.id}> You have been unsubscribed from this ticket`).setTimestamp().setColor(config.botColor);
            await i.reply({ embeds: [embed] });
        }

        if (i.commandName === "add") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: "❌ You do not have permission to do this!", flags: MessageFlags.Ephemeral });
            }
            if (!i.channel.topic?.toLowerCase().includes("ticket")) {
                return i.reply({ content: "❌ This is not a ticket channel!", flags: MessageFlags.Ephemeral });
            }
            const user = i.options.getUser("user");
            const role = i.options.getRole("role");
            if (user) {
                await i.channel.permissionOverwrites.create(user, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
                const embed = new EmbedBuilder().setTitle("User Added!").setDescription(`<@${user.id}> was added to the ticket by <@${i.user.id}>`).setColor(config.botColor).setTimestamp();
                await i.reply({ embeds: [embed] });
                const dmEmbed = new EmbedBuilder()
                    .setTitle("New Ticket!")
                    .setDescription(`<@${user.id}> you were added to a ticket by <@${i.user.id}>`)
                    .addFields({ name: "Ticket", value: `<#${i.channel.id}>` })
                    .setColor(config.botColor)
                    .setTimestamp();
                user.send({ embeds: [dmEmbed] }).catch(() => {});
            }
            if (role) {
                await i.channel.permissionOverwrites.create(role.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
                const embed = new EmbedBuilder().setTitle("Role Added!").setDescription(`<@&${role.id}> was added to the ticket by <@${i.user.id}>`).setColor(config.botColor).setTimestamp();
                if (!user) await i.reply({ embeds: [embed] });
            }
        }

        if (i.commandName === "remove") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: "❌ You do not have permission to do this!", flags: MessageFlags.Ephemeral });
            }
            if (!i.channel.topic?.toLowerCase().includes("ticket")) {
                return i.reply({ content: "❌ This is not a ticket channel!", flags: MessageFlags.Ephemeral });
            }
            const user = i.options.getUser("user");
            const role = i.options.getRole("role");
            if (user) {
                await i.channel.permissionOverwrites.create(user, { ViewChannel: false });
                const embed = new EmbedBuilder().setTitle("User Removed!").setDescription(`<@${user.id}> was removed from the ticket by <@${i.user.id}>`).setColor(config.botColor).setTimestamp();
                await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            }
            if (role) {
                await i.channel.permissionOverwrites.create(role.id, { ViewChannel: false });
                const embed = new EmbedBuilder().setTitle("Role Removed!").setDescription(`<@&${role.id}> was removed from the ticket by <@${i.user.id}>`).setColor(config.botColor).setTimestamp();
                if (!user) await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            }
        }

        if (i.commandName === "move") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: "❌ You do not have permission to do this!", flags: MessageFlags.Ephemeral });
            }
            if (!i.channel.topic?.toLowerCase().includes("ticket")) {
                return i.reply({ content: "❌ This is not a ticket channel!", flags: MessageFlags.Ephemeral });
            }
            const category = i.options.getChannel("category");
            const userId = i.channel.topic?.split(' - ')[1];
            await i.channel.setParent(category.id, { lockPermissions: true });
            await i.channel.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
            const embed = new EmbedBuilder().setTitle("✅ Ticket Moved").setDescription(`This ticket has been moved to **${category.name}**`).setColor(config.botColor).setTimestamp();
            await i.reply({ embeds: [embed] });
        }

        if (i.commandName === "transfer") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: "❌ You do not have permission to do this!", flags: MessageFlags.Ephemeral });
            }
            if (!i.channel.topic?.toLowerCase().includes("ticket")) {
                return i.reply({ content: "❌ This is not a ticket channel!", flags: MessageFlags.Ephemeral });
            }
            const newUser = i.options.getUser("user");
            const topicParts = i.channel.topic.split(' - ');
            const ticketType = topicParts[0];
            const oldUserId = topicParts[1];
            const ticketCategory = i.channel.name.split('-').pop();
            const emoji = i.channel.name.match(/^[^\w]+/)?.[0] || "📞";
            await i.channel.setTopic(`${ticketType} - ${newUser.id}`);
            await i.channel.permissionOverwrites.create(newUser.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
            await i.channel.setName(`${emoji}${newUser.displayName}-${ticketCategory}`.toLowerCase());
            const embed = new EmbedBuilder()
                .setTitle("🔄 Ticket Transferred")
                .setDescription(`This ticket has been transferred from <@${oldUserId}> to <@${newUser.id}>`)
                .addFields(
                    { name: "Ticket Type", value: ticketType, inline: true },
                    { name: "Transferred By", value: `<@${i.user.id}>`, inline: true },
                    { name: "New Owner", value: `<@${newUser.id}>`, inline: true }
                )
                .setColor(config.botColor)
                .setTimestamp();
            await i.reply({ embeds: [embed] });
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle("📩 Ticket Transferred to You")
                    .setDescription(`You are now the owner of a **${ticketType}**: **${i.channel.name}**`)
                    .addFields(
                        { name: "Channel", value: `<#${i.channel.id}>`, inline: false },
                        { name: "Transferred By", value: `${i.user.tag}`, inline: false }
                    )
                    .setColor(config.botColor)
                    .setTimestamp();
                await newUser.send({ embeds: [dmEmbed] });
            } catch (error) {
                if (error.code !== 50007) console.error("Error sending DM:", error);
            }
        }

        if (i.commandName === "remind") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: `<@${i.user.id}> You are not a <@&${config.staffRole}>`, flags: MessageFlags.Ephemeral });
            }
            const user = i.options.getUser("user");
            const hours = i.options.getNumber("hours");
            const reminder = i.options.getString("reminder");
            const reminderTime = Date.now() + (hours * 60 * 60 * 1000);
            if (!reminders[user.id]) reminders[user.id] = [];
            reminders[user.id].push({ reminder, reminderTime, createdAt: Date.now() });
            const embed = new EmbedBuilder()
                .setTitle(`⏰ Reminder Created`)
                .setColor(config.botColor)
                .setDescription(`<@${user.id}> will receive a reminder in ${hours} hours!`)
                .setTimestamp();
            await i.reply({ content: `<@${i.user.id}> A reminder was successfully created!`, embeds: [embed] });
        }

        if (i.commandName === "server-info") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: `<@${i.user.id}> You are not a <@&${config.staffRole}>`, flags: MessageFlags.Ephemeral });
            }
            const embed = new EmbedBuilder()
                .setTitle("Server Info")
                .setColor(config.botColor)
                .setTimestamp()
                .addFields(
                    { name: "Members", value: `${guild.memberCount}`, inline: true },
                    { name: "Channels", value: `${guild.channels.cache.size}`, inline: true }
                );
            await i.reply({ content: `Here is the server info <@${i.user.id}>`, embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (i.commandName === "ping") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: `<@${i.user.id}> You are not a <@&${config.staffRole}>`, flags: MessageFlags.Ephemeral });
            }
            const user = i.options.getUser("user");
            await i.reply({ content: `<@${user.id}> you got pinged!` });
        }

        if (i.commandName === "paypal") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: `<@${i.user.id}> You are not a <@&${config.staffRole}>`, flags: MessageFlags.Ephemeral });
            }
            const user = i.options.getUser("user");
            const amount = i.options.getNumber("amount");
            let paypal = "";
            let paypalLink = "";
            if (user.id === "394663095320182794") {
                paypal = "declan958@gmail.com";
                paypalLink = "https://www.paypal.com/paypalme/mariushanssen";
            } else {
                paypal = "marius04@outlook.com";
                paypalLink = "https://www.paypal.com/paypalme/mariushanssen";
            }
            const embed = new EmbedBuilder()
                .setTitle(`PayPal £${amount}`)
                .setColor(config.botColor)
                .setTimestamp()
                .addFields(
                    { name: "Email", value: paypal, inline: false },
                    { name: "Amount", value: `£${amount}`, inline: false },
                    { name: "Info", value: `Payment must be sent as **FRIENDS AND FAMILY**, if not it will not be a valid payment. You need to make sure you send in £(GBP) to **${paypal}**`, inline: false }
                );
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setURL(paypalLink).setLabel("Open Paypal").setStyle(ButtonStyle.Link).setEmoji("💲")
                );
            await i.reply({ content: `@here`, embeds: [embed], components: [row] });
        }

        if (i.commandName === "mention") {
            if (!i.member.roles.cache.has(config.staffRole)) {
                return i.reply({ content: `<@${i.user.id}> You don't have permission to use this.`, flags: MessageFlags.Ephemeral });
            }
            const user = i.options.getUser("user");
            const embedReply = new EmbedBuilder()
                .setDescription(`<@${user.id}> has been alerted!`)
                .setColor("#0400ff")
                .setTimestamp();
            const embedSend = new EmbedBuilder()
                .setTitle("You are needed!")
                .setThumbnail(guild.iconURL({ size: 512, dynamic: true }))
                .addFields(
                    { name: "Channel", value: `<#${i.channel.id}>`, inline: false },
                    { name: "By", value: `<@${i.user.id}>` }
                )
                .setColor("#0400ff")
                .setTimestamp();
            try {
                await user.send({ embeds: [embedSend] });
                await i.reply({ embeds: [embedReply] });
            } catch (error) {
                await i.reply({ content: `Could not send DM to <@${user.id}>. They might have DMs disabled.`, ephemeral: true });
            }
        }
    }
});
// ── Whitelist application submission (called by the website API route) ────────
app.post('/submit-application', async (req, res) => {
    if (req.headers['x-api-secret'] !== config.botApiSecret) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const { discordId, discordUsername } = req.body;
    if (!discordId) return res.status(400).json({ error: 'Missing discordId' });

    try {
        const connection = await pool.getConnection();

        // Prevent duplicate pending applications
        const [existing] = await connection.query(
            `SELECT status FROM whitelistApplications WHERE discord_id = ?`,
            [discordId]
        );
        if (existing.length > 0 && existing[0].status === 'pending') {
            connection.release();
            return res.status(409).json({ error: 'You already have a pending application.' });
        }

        // Upsert — allow reapply after rejection
        await connection.query(
            `INSERT INTO whitelistApplications (discord_id, discord_username, status, submitted_at)
             VALUES (?, ?, 'pending', NOW())
             ON DUPLICATE KEY UPDATE status = 'pending', discord_username = ?, submitted_at = NOW(), reviewed_by = NULL, reviewed_at = NULL`,
            [discordId, discordUsername, discordUsername]
        );
        connection.release();
        res.json({ success: true });
    } catch (error) {
        console.error('Submit application DB error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/github-webhook', async (req, res) => {
    res.status(200).send('OK');

    const payload = req.body;
    if (!payload.commits || payload.commits.length === 0) return;

    try {
        const channel = await client.channels.fetch(config.githubChannel);
        const connection = await pool.getConnection();
        const [devRows] = await connection.query('SELECT user_id, github_username FROM githubDevs');
        connection.release();

        const devMap = {};
        for (const row of devRows) {
            devMap[row.github_username.toLowerCase()] = row.user_id;
        }

        console.log('Commit authors:', payload.commits.map(c => c.author.name));
        console.log('DevMap keys:', Object.keys(devMap));

        for (const commit of payload.commits) {
            const githubAuthor = commit.author.name.toLowerCase();
            if (!devMap[githubAuthor]) continue;

            const titleLine = commit.message.split('\n')[0];
            const descLines = commit.message.split('\n').slice(2).join('\n').trim();
            const discordUserId = devMap[githubAuthor];
            const authorDisplay = `<@${discordUserId}>`;
            const repo = payload.repository.name;

            const dbConn = await pool.getConnection();
            await dbConn.query(
                'INSERT INTO devCommits (user_id, github_username, repo, commit_hash, commit_title, commit_date) VALUES (?, ?, ?, ?, ?, ?)',
                [discordUserId, githubAuthor, repo, commit.id, titleLine, new Date(commit.timestamp)]
            );
            dbConn.release();

            const guild = await client.guilds.fetch(config.guildId);
            const embed = new EmbedBuilder()
                .setTitle(`Dev log — ${titleLine}`)
                .setDescription(descLines ? `\`\`\`${descLines}\`\`\`` : null)
                .setColor(config.botColor)
                .setThumbnail(guild.iconURL({ size: 512 }))
                .addFields(
                    { name: '\u200B', value: '\u200B' },
                    { name: 'Developer', value: authorDisplay, inline: true }
                )
                .setTimestamp(new Date(commit.timestamp));

            await channel.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error('GitHub webhook error:', error);
    }
});

app.listen(55627, () => console.log('Webhook listening on port 55627'));

client.login(config.token);
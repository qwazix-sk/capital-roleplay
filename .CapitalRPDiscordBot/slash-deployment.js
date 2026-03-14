const {REST, Routes} = require("discord.js")
const config = require("./config.json")

const rest = new REST().setToken(config.token)

const slashCommands = async () => {
    try {
        await rest.put(Routes.applicationGuildCommands(config.clientId, config.serverId), {
            body: [
                {
                    name: "info",
                    description: "Show all bot commands for this bot"
                },
                {
                    name: "mention",
                    description: "Mention a user!",
                    options: [
                        {
                            name: "user",
                            description: "Who do you want to mention",
                            type: 6,
                            required: true
                        }
                    ]
                },
                {
                    name: "links",
                    description: "Shows list of relevant links for staff/developers"
                },
                {
                    name: "add-streamer",
                    description: "Add a streamer to track for live notifications",
                    options: [
                        {
                            name: "user",
                            description: "Discord user to track",
                            type: 6,
                            required: true
                        },
                        {
                            name: "twitch-url",
                            description: "Twitch channel URL",
                            type: 3,
                            required: true
                        }
                    ]
                },
                {
                    name: "remove-streamer",
                    description: "Remove a tracked streamer",
                    options: [
                        {
                            name: "user",
                            description: "Discord user to remove",
                            type: 6,
                            required: true
                        }
                    ]
                },
                {
                    name: "name-change-message",
                    description: "Post name change message info"
                },
                {
                    name: "namechange",
                    description: "Request a discord name change",
                    options: [
                        {
                            name: "name",
                            description: "Enter name to change to",
                            type: 3,
                            required: true
                        }
                    ]
                },
                {
                    name: "update",
                    description: "Create a new development update"
                },
                {
                    name: "bugreport",
                    description: "Report a bug to our development team"
                },
                {
                    name: "bug-stats",
                    description: "View bug report statistics and developer leaderboard"
                },
                {
                    name: "suggestion",
                    description: "Create a suggestion"
                },
                {
                    name: "purge",
                    description: "Delete a certain amount of messages (max 100)",
                    options: [
                        {
                            name: "amount",
                            description: "How many messages (max 100)",
                            type: 10,
                            maxLength: 100,
                            required: true
                        }
                    ]
                },
                {
                    name: "close",
                    description: "Close the ticket you are in"
                },
                {
                    name: "rclose",
                    description: "Request ticket closure"
                },
                {
                    name: "sub",
                    description: "Get notified when messages are sent in this ticket"
                },
                {
                    name: "unsub",
                    description: "Remove a channel subscription"
                },
                {
                    name: "add",
                    description: "Add a user or role to this ticket",
                    options: [
                        {
                            name: "user",
                            description: "Select who to add to the ticket",
                            type: 6,
                            required: false
                        },
                        {
                            name: "role",
                            description: "Select a role to add",
                            type: 8,
                            required: false
                        }
                    ]
                },
                {
                    name: "remove",
                    description: "Remove a user or role from this ticket",
                    options: [
                        {
                            name: "user",
                            description: "Select who to remove from the ticket",
                            type: 6,
                            required: false
                        },
                        {
                            name: "role",
                            description: "Select a role to remove",
                            type: 8,
                            required: false
                        }
                    ]
                },
                {
                    name: "move",
                    description: "Move this channel to another category",
                    options: [
                        {
                            name: "category",
                            description: "Select which category",
                            type: 7,
                            required: true,
                            channel_types: [4]
                        }
                    ]
                },
                {
                    name: "transfer",
                    description: "Transfer ticket ownership to another user",
                    options: [
                        {
                            name: "user",
                            description: "Who should be the new ticket owner?",
                            type: 6,
                            required: true
                        }
                    ]
                },
                {
                    name: "ticket-stats",
                    description: "View ticket statistics and staff leaderboard",
                    options: [
                        {
                            name: "days",
                            description: "Number of days to show stats for (leave empty for all time)",
                            type: 10,
                            required: false
                        }
                    ]
                },
                {
                    name: "remind",
                    description: "Set a reminder for a user",
                    options: [
                        {
                            name: "user",
                            description: "Who to remind",
                            type: 6,
                            required: true
                        },
                        {
                            name: "hours",
                            description: "How many hours until the reminder",
                            type: 10,
                            required: true
                        },
                        {
                            name: "reminder",
                            description: "What to remind them about",
                            type: 3,
                            required: true
                        }
                    ]
                },
                {
                    name: "devlogs",
                    description: "Show overall development statistics"
                },
                {
                    name: "commitstats",
                    description: "View commit statistics for a developer",
                    options: [
                        {
                            name: "user",
                            description: "Discord user to check (leave empty for all devs)",
                            type: 6,
                            required: false
                        },
                        {
                            name: "days",
                            description: "Number of days to filter by (leave empty for all time)",
                            type: 10,
                            required: false
                        }
                    ]
                },
                {
                    name: "showcollabs",
                    description: "Show all collaborators for a repo",
                    options: [
                        {
                            name: "repo",
                            description: "Which repo to check",
                            type: 3,
                            required: true,
                            choices: [
                                { name: "CRScripts", value: "CRScripts" },
                                { name: "CRVehicles", value: "CRVehicles" },
                                { name: "CRStandalone", value: "CRStandalone" },
                                { name: "CRCore", value: "CRCore" },
                                { name: "CRCustom", value: "CRCustom" },
                                { name: "CRWeapons", value: "CRWeapons" },
                                { name: "CRMlo", value: "CRMlo" },
                                { name: "CROx", value: "CROx" },
                                { name: "CRClothing", value: "CRClothing" },
                                { name: "CRDependencies", value: "CRDependencies" }
                            ]
                        }
                    ]
                },
                {
                    name: "removecollab",
                    description: "Remove a GitHub collaborator from a repo",
                    options: [
                        {
                            name: "githubusername",
                            description: "Their GitHub username",
                            type: 3,
                            required: true
                        },
                        {
                            name: "repo",
                            description: "Which repo to remove them from",
                            type: 3,
                            required: true,
                        choices: [
                            { name: "All", value: "all" },
                            { name: "CRScripts", value: "CRScripts" },
                            { name: "CRVehicles", value: "CRVehicles" },
                            { name: "CRStandalone", value: "CRStandalone" },
                            { name: "CRCore", value: "CRCore" },
                            { name: "CRCustom", value: "CRCustom" },
                            { name: "CRWeapons", value: "CRWeapons" },
                            { name: "CRMlo", value: "CRMlo" },
                            { name: "CROx", value: "CROx" },
                            { name: "CRClothing", value: "CRClothing" },
                            { name: "CRDependencies", value: "CRDependencies" }
                        ]
                                                }
                    ]
                },
                {
                    name: "addcollab",
                    description: "Add a GitHub collaborator to a repo",
                    options: [
                        {
                            name: "user",
                            description: "Discord user",
                            type: 6,
                            required: true
                        },
                        {
                            name: "githubusername",
                            description: "Their GitHub username",
                            type: 3,
                            required: true
                        },
                        {
                            name: "repo",
                            description: "Which repo to add them to",
                            type: 3,
                            required: true,
                            choices: [
                                { name: "CRScripts", value: "CRScripts" },
                                { name: "CRVehicles", value: "CRVehicles" },
                                { name: "CRStandalone", value: "CRStandalone" },
                                { name: "CRCore", value: "CRCore" },
                                { name: "CRCustom", value: "CRCustom" },
                                { name: "CRWeapons", value: "CRWeapons" },
                                { name: "CRMlo", value: "CRMlo" },
                                { name: "CROx", value: "CROx" },
                                { name: "CRClothing", value: "CRClothing" },
                                { name: "CRDependencies", value: "CRDependencies" }
                            ]
                        }
                    ]
                },
                {
                    name: "pull",
                    description: "Pull latest changes for a repo on the VPS",
                    options: [
                        {
                            name: "repo",
                            description: "Which repo to pull",
                            type: 3,
                            required: true,
                            choices: [
                                { name: "CRScripts", value: "CRScripts" },
                                { name: "CRVehicles", value: "CRVehicles" },
                                { name: "CRStandalone", value: "CRStandalone" },
                                { name: "CRCore", value: "CRCore" },
                                { name: "CRCustom", value: "CRCustom" },
                                { name: "CRWeapons", value: "CRWeapons" },
                                { name: "CRMlo", value: "CRMlo" },
                                { name: "CROx", value: "CROx" },
                                { name: "CRClothing", value: "CRClothing" },
                                { name: "CRDependencies", value: "CRDependencies" }
                            ]
                        }
                    ]
                },
                {
                    name: "adddev",
                    description: "Link a Discord user to a GitHub username",
                    options: [
                        {
                            name: "user",
                            description: "Discord user",
                            type: 6,
                            required: true
                        },
                        {
                            name: "githubusername",
                            description: "Their GitHub username",
                            type: 3,
                            required: true
                        }
                    ]
                },
                {
                    name: "removedev",
                    description: "Remove a GitHub username link",
                    options: [
                        {
                            name: "user",
                            description: "Discord user to remove",
                            type: 6,
                            required: true
                        }
                    ]
                },
                {
                    name: "showdevs",
                    description: "Show all linked GitHub developers"
                },
                {
                    name: "verify-message",
                    description: "Send verify embed to verify channel"
                },
                {
                    name: "server-info",
                    description: "View server information"
                },
                {
                    name: "ping",
                    description: "Ping a user",
                    options: [
                        {
                            name: "user",
                            description: "Who to ping",
                            type: 6,
                            required: true
                        }
                    ]
                },
                {
                    name: "paypal",
                    description: "Send PayPal payment details",
                    options: [
                        {
                            name: "user",
                            description: "Who to send PayPal to",
                            type: 6,
                            required: true
                        },
                        {
                            name: "amount",
                            description: "Amount to send",
                            type: 10,
                            required: true
                        }
                    ]
                }
            ]
        })
    } catch (err) {
        console.error(err)
    }
}

slashCommands();
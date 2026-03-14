/**
 * Cloudflare Worker — Discord Live Stats
 *
 * SETUP:
 *  1. Deploy this file to Cloudflare Workers (wrangler deploy or dashboard paste)
 *  2. Add two secrets in your Worker settings:
 *       DISCORD_BOT_TOKEN   — your Discord bot token
 *       DISCORD_GUILD_ID    — your Discord server/guild ID
 *  3. Copy your Worker URL (e.g. https://discord-count.YOUR-NAME.workers.dev)
 *  4. Paste it into PUBLIC_DISCORD_WORKER_URL in your .env file
 *
 * HOW TO GET YOUR GUILD ID:
 *  - In Discord, go to Server Settings → right-click the server icon → Copy Server ID
 *  - Developer Mode must be on (User Settings → Advanced → Developer Mode)
 *
 * HOW TO GET A BOT TOKEN:
 *  - Go to https://discord.com/developers/applications → New Application
 *  - Bot tab → Reset Token → copy
 *  - Add the bot to your server with no permissions needed (just "Read Server Members Intent")
 *  - Enable "Server Members Intent" under Bot → Privileged Gateway Intents
 */

export default {
  async fetch(request, env) {
    // Allow CORS so your website can call this from the browser
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const GUILD_ID = env.DISCORD_GUILD_ID;
    const BOT_TOKEN = env.DISCORD_BOT_TOKEN;

    if (!GUILD_ID || !BOT_TOKEN) {
      return new Response(
        JSON.stringify({ error: "Missing DISCORD_GUILD_ID or DISCORD_BOT_TOKEN secrets" }),
        { status: 500, headers: corsHeaders }
      );
    }

    try {
      const res = await fetch(
        `https://discord.com/api/v10/guilds/${GUILD_ID}?with_counts=true`,
        {
          headers: {
            Authorization: `Bot ${BOT_TOKEN}`,
          },
        }
      );

      if (!res.ok) {
        throw new Error(`Discord API returned ${res.status}`);
      }

      const data = await res.json();

      return new Response(
        JSON.stringify({
          members: data.approximate_member_count ?? null,
          online: data.approximate_presence_count ?? null,
        }),
        {
          headers: {
            ...corsHeaders,
            // Cache for 60 seconds — keeps it live without hammering Discord
            "Cache-Control": "public, max-age=60",
          },
        }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 500, headers: corsHeaders }
      );
    }
  },
};

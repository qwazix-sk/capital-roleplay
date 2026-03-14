/**
 * Cloudflare Worker — Discord Live Stats
 *
 * NO BOT TOKEN REQUIRED. Uses Discord's public invite API.
 *
 * SETUP:
 *  1. Paste this file into your Worker in the Cloudflare dashboard (or wrangler deploy)
 *  2. No secrets needed — the invite code is hardcoded below
 *     (optionally override via DISCORD_INVITE_CODE env var)
 *
 * Sources (in order of priority):
 *  1. Discord Invite API  — public, returns both member count + online count
 *  2. Discord Widget API  — public fallback for online count only
 */

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    // Invite code from the Join button on the website
    const INVITE = env.DISCORD_INVITE_CODE ?? "drpNDbTgBM";
    // Guild ID as a fallback for the widget API
    const GUILD  = env.DISCORD_GUILD_ID    ?? "1478455683576893472";

    let members = 0;
    let online  = 0;

    // ── 1. Invite API — no auth, gives approximate_member_count + approximate_presence_count ──
    try {
      const res = await fetch(
        `https://discord.com/api/v10/invites/${INVITE}?with_counts=true`,
        { headers: { "User-Agent": "CapitalRoleplay-Stats/1.0" } }
      );

      if (res.ok) {
        const d = await res.json();
        if (typeof d.approximate_member_count  === "number" && d.approximate_member_count  > 0) members = d.approximate_member_count;
        if (typeof d.approximate_presence_count === "number" && d.approximate_presence_count > 0) online  = d.approximate_presence_count;
      }
    } catch (_) { /* invite API unreachable — fall through */ }

    // ── 2. Widget API fallback — online count only ───────────────────────────
    if (online === 0) {
      try {
        const res = await fetch(`https://discord.com/api/v10/guilds/${GUILD}/widget.json`);
        if (res.ok) {
          const d = await res.json();
          // widget disabled → d.code === 50004
          if (typeof d.presence_count === "number" && d.presence_count > 0) {
            online = d.presence_count;
          }
        }
      } catch (_) { /* widget unreachable */ }
    }

    return new Response(
      JSON.stringify({ members, online }),
      {
        headers: {
          ...cors,
          // 30-second browser cache — keeps it fresh without hammering Discord
          "Cache-Control": "public, max-age=30, s-maxage=30",
        },
      }
    );
  },
};

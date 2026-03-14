/**
 * Cloudflare Worker — Discord Live Stats
 *
 * NO BOT TOKEN REQUIRED. Uses Discord's public invite API.
 *
 * SETUP:
 *  1. Paste this file into your Worker in the Cloudflare dashboard (or wrangler deploy)
 *  2. No secrets needed — invite code + guild ID are hardcoded below
 *
 * Stability: Discord's API returns "approximate" counts that fluctuate ±1 per
 * request. This Worker caches its outgoing Discord fetches at the Cloudflare
 * edge for 60 seconds (cf.cacheTtl), so every visitor within that window sees
 * the exact same numbers — no more jumping.
 *
 * Sources (in order):
 *  1. Discord Invite API  — public, gives member count + online count
 *  2. Discord Widget API  — public fallback for online count only
 */

export default {
  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const INVITE = env.DISCORD_INVITE_CODE ?? "drpNDbTgBM";
    const GUILD  = env.DISCORD_GUILD_ID    ?? "1478455683576893472";
    const TTL    = 60; // seconds — how long Cloudflare's edge caches Discord's response

    let members = 0;
    let online  = 0;

    // ── 1. Invite API — cached at Cloudflare edge for TTL seconds ───────────
    //    The `cf` option tells Cloudflare's CDN to cache this outgoing fetch.
    //    All Worker invocations within the TTL window share the same cached
    //    Discord response, so the returned numbers never jump between requests.
    try {
      const res = await fetch(
        `https://discord.com/api/v10/invites/${INVITE}?with_counts=true`,
        {
          headers: { "User-Agent": "CapitalRoleplay-Stats/1.0" },
          cf: {
            cacheTtl: TTL,
            cacheEverything: true,
          },
        }
      );

      if (res.ok) {
        const d = await res.json();
        if (typeof d.approximate_member_count  === "number" && d.approximate_member_count  > 0) members = d.approximate_member_count;
        if (typeof d.approximate_presence_count === "number" && d.approximate_presence_count > 0) online  = d.approximate_presence_count;
      }
    } catch (_) { /* invite API unreachable — fall through */ }

    // ── 2. Widget API fallback — online count only, also edge-cached ─────────
    if (online === 0) {
      try {
        const res = await fetch(
          `https://discord.com/api/v10/guilds/${GUILD}/widget.json`,
          { cf: { cacheTtl: TTL, cacheEverything: true } }
        );
        if (res.ok) {
          const d = await res.json();
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
          // Also tell browsers/CDN to cache the Worker response itself
          "Cache-Control": `public, max-age=${TTL}, s-maxage=${TTL}`,
        },
      }
    );
  },
};

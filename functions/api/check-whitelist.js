const WHITELIST_ROLE = '1478489840260747275';

export async function onRequestGet({ request, env }) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookies = Object.fromEntries(
    cookieHeader.split('; ').filter(Boolean).map(c => {
      const idx = c.indexOf('=');
      return [c.slice(0, idx).trim(), decodeURIComponent(c.slice(idx + 1))];
    })
  );

  if (!cookies.dc_user) {
    return json({ whitelisted: false, reason: 'not_authenticated' });
  }

  let user;
  try {
    user = JSON.parse(cookies.dc_user);
  } catch {
    return json({ whitelisted: false, reason: 'not_authenticated' });
  }

  const guildId = (env.DISCORD_GUILD_ID || '1478455683576893472').trim();
  try {
    const memberRes = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${user.id}`,
      { headers: { Authorization: `Bot ${(env.DISCORD_BOT_TOKEN || '').trim()}` } }
    );
    if (!memberRes.ok) return json({ whitelisted: false, reason: 'not_in_server' });
    const member = await memberRes.json();
    const has = Array.isArray(member.roles) && member.roles.includes(WHITELIST_ROLE);
    return json({ whitelisted: has, reason: has ? 'ok' : 'no_role' });
  } catch {
    return json({ whitelisted: false, reason: 'error' });
  }
}

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
}

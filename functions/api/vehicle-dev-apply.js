const WHITELIST_ROLE  = '1478489840260747275';
const VDEV_CHANNEL    = '1483820836606578699';

export async function onRequestPost({ request, env }) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookies = Object.fromEntries(
    cookieHeader.split('; ').filter(Boolean).map(c => {
      const idx = c.indexOf('=');
      return [c.slice(0, idx).trim(), decodeURIComponent(c.slice(idx + 1))];
    })
  );

  if (!cookies.dc_user || !cookies.dc_token) {
    return json({ error: 'Not authenticated — please sign in with Discord first' }, 401);
  }

  let user;
  try {
    user = JSON.parse(cookies.dc_user);
  } catch {
    return json({ error: 'Invalid session — please sign in again' }, 401);
  }

  const verifyRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${cookies.dc_token}` },
  });
  if (!verifyRes.ok) {
    return json({ error: 'Session expired — please sign in again' }, 401);
  }

  const guildId = (env.DISCORD_GUILD_ID || '1478455683576893472').trim();
  const memberRes = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${user.id}`,
    { headers: { Authorization: `Bot ${(env.DISCORD_BOT_TOKEN || '').trim()}` } }
  );

  if (!memberRes.ok) {
    return json({ error: 'Could not verify your server membership. Make sure you are in the Capital Roleplay Discord.' }, 403);
  }

  const member = await memberRes.json();
  if (!member.roles || !member.roles.includes(WHITELIST_ROLE)) {
    return json({ error: 'You must be a whitelisted member of Capital Roleplay before applying.' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const { age, timezone, portfolio, skill_meta, skill_model, skill_zmod, vdev_experience, why_vdev } = body;

  if (!age?.trim() || !timezone?.trim() || !vdev_experience?.trim() || !why_vdev?.trim()) {
    return json({ error: 'Please fill in all required fields' }, 400);
  }

  const whyWords = why_vdev.trim().split(/\s+/).filter(w => w.length > 0).length;
  if (whyWords < 50) {
    return json({ error: `"Why do you want to be a Vehicle Developer" must be at least 50 words (currently ${whyWords})` }, 400);
  }

  const skillLines = [
    skill_meta  ? '✅ Meta file experience'          : '☐ Meta file experience',
    skill_model ? '✅ Model and garage edits'         : '☐ Model and garage edits',
    skill_zmod  ? '✅ ZMod3 / Blender (Sollumz)'     : '☐ ZMod3 / Blender (Sollumz)',
  ].join('\n');

  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;

  const embed = {
    title: '🚗 New Vehicle Developer Application',
    color: 0xa855f7,
    thumbnail: { url: avatarUrl },
    timestamp: new Date().toISOString(),
    footer: { text: `Vehicle Developer application from ${user.username}` },
    fields: [
      { name: 'Discord',              value: `<@${user.id}> (${user.username})`,                              inline: true },
      { name: 'Age',                  value: age.trim(),                                                       inline: true },
      { name: 'Timezone',             value: timezone.trim(),                                                   inline: true },
      { name: 'Portfolio / Links',             value: (portfolio?.trim() || '*Not provided*').slice(0, 500), inline: false },
      { name: 'Skills & Experience',           value: skillLines,                                             inline: false },
      { name: 'Vehicle Dev Experience',        value: vdev_experience.trim().slice(0, 1024) },
      { name: 'Why Vehicle Developer for Capital RP?', value: why_vdev.trim().slice(0, 1024) },
    ],
  };

  const components = [{
    type: 1,
    components: [
      { type: 2, style: 3, label: '✅  Accept',              custom_id: `vdev_accept_${user.id}` },
      { type: 2, style: 1, label: '📋  Invite to Interview', custom_id: `vdev_interview_${user.id}` },
      { type: 2, style: 4, label: '❌  Reject',               custom_id: `vdev_reject_${user.id}` },
    ],
  }];

  const discordRes = await fetch(
    `https://discord.com/api/v10/channels/${VDEV_CHANNEL}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bot ${(env.DISCORD_BOT_TOKEN || '').trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ embeds: [embed], components }),
    }
  );

  if (!discordRes.ok) {
    const err = await discordRes.text();
    console.error('Discord API error:', err);
    return json({ error: 'Failed to submit application — please try again' }, 500);
  }

  return json({ success: true }, 200);
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

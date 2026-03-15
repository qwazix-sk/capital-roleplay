const WHITELIST_CHANNEL = '1482373975316365472';

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

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const { fullname, dob, experience, character, whyjoin } = body;

  if (!fullname?.trim() || !dob?.trim() || !whyjoin?.trim()) {
    return json({ error: 'Please fill in all required fields' }, 400);
  }

  const wordCount = whyjoin.trim().split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount < 100) {
    return json({ error: `"Why do you want to join" must be at least 100 words (currently ${wordCount})` }, 400);
  }

  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;

  // Split text into ≤4096-char chunks for embed descriptions
  function descChunks(label, text, color) {
    const LIMIT = 4096;
    const embeds = [];
    let remaining = text.trim();
    let first = true;
    while (remaining.length > 0) {
      let slice = remaining.slice(0, LIMIT);
      if (remaining.length > LIMIT) {
        const lastSpace = slice.lastIndexOf(' ');
        if (lastSpace > 0) slice = slice.slice(0, lastSpace);
      }
      embeds.push({ color, title: first ? label : `${label} (continued)`, description: slice.trim() });
      remaining = remaining.slice(slice.length).trim();
      first = false;
    }
    return embeds;
  }

  const embeds = [
    // Embed 1: header info
    {
      title: 'New Whitelist Application',
      color: 0x00aeff,
      thumbnail: { url: avatarUrl },
      timestamp: new Date().toISOString(),
      footer: { text: `Application from ${user.username}` },
      fields: [
        { name: 'Discord',       value: `<@${user.id}> (${user.username})`,                      inline: true },
        { name: 'Full Name',     value: fullname.trim(),                                          inline: true },
        { name: '\u200B',        value: '\u200B',                                                 inline: false },
        { name: 'Date of Birth', value: dob.trim(),                                               inline: true },
        { name: 'RP Experience', value: (experience?.trim() || '*Not provided*').slice(0, 500),   inline: true },
      ],
    },
    // Embed 2+: Character Concept in description (up to 4096 chars each)
    ...descChunks('Character Concept', character?.trim() || '*Not provided*', 0x00aeff),
    // Embed 3+: Why do you want to join in description
    ...descChunks('Why do you want to join Capital Roleplay?', whyjoin.trim(), 0x00aeff),
  ];

  const components = [{
    type: 1,
    components: [
      { type: 2, style: 3, label: '✅  Accept', custom_id: `wl_accept_${user.id}` },
      { type: 2, style: 4, label: '❌  Reject', custom_id: `wl_reject_${user.id}` },
    ],
  }];

  // Optional: duplicate check via bot API
  const botApiUrl = (env.BOT_API_URL || '').trim();
  if (botApiUrl) {
    try {
      const dbRes = await fetch(`${botApiUrl}/submit-application`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-secret': env.BOT_API_SECRET ?? '' },
        body: JSON.stringify({ discordId: user.id, discordUsername: user.username }),
        signal: AbortSignal.timeout(3000),
      });
      if (!dbRes.ok && dbRes.status === 409) {
        const dbErr = await dbRes.json().catch(() => ({}));
        return json({ error: dbErr.error ?? 'You already have a pending application' }, 409);
      }
    } catch { /* unreachable — continue */ }
  }

  const discordRes = await fetch(
    `https://discord.com/api/v10/channels/${WHITELIST_CHANNEL}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bot ${(env.DISCORD_BOT_TOKEN || '').trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ embeds, components }),
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

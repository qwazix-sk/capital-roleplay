export async function onRequestPost({ request, env }) {
  // Parse cookies from request
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

  // Verify token is still valid
  const verifyRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${cookies.dc_token}` },
  });
  if (!verifyRes.ok) {
    return json({ error: 'Session expired — please sign in again' }, 401);
  }

  // Parse form body
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const { fullname, age, experience, character, whyjoin } = body;

  if (!fullname?.trim() || !age || !experience || !whyjoin?.trim()) {
    return json({ error: 'Please fill in all required fields' }, 400);
  }

  const wordCount = whyjoin.trim().split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount < 100) {
    return json({ error: `"Why do you want to join" must be at least 100 words (currently ${wordCount})` }, 400);
  }

  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;

  const embed = {
    title: 'New Whitelist Application',
    color: 0x00aeff,
    thumbnail: { url: avatarUrl },
    fields: [
      { name: 'Discord', value: `<@${user.id}> (${user.username})`, inline: true },
      { name: 'Full Name', value: fullname, inline: true },
      { name: '\u200B', value: '\u200B', inline: false },
      { name: 'Age', value: age, inline: true },
      { name: 'RP Experience', value: experience, inline: true },
      { name: '\u200B', value: '\u200B', inline: false },
      { name: 'Character Concept', value: character?.trim() || '*Not provided*' },
      { name: 'Why do you want to join?', value: whyjoin },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: `Application from ${user.username}` },
  };

  const components = [{
    type: 1,
    components: [
      { type: 2, style: 3, label: 'Accept', custom_id: `wl_accept_${user.id}` },
      { type: 2, style: 4, label: 'Reject', custom_id: `wl_reject_${user.id}` },
    ],
  }];

  // Optional: register with bot API for duplicate prevention
  const botApiUrl = env.BOT_API_URL;
  if (botApiUrl) {
    const dbRes = await fetch(`${botApiUrl}/submit-application`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': env.BOT_API_SECRET ?? '',
      },
      body: JSON.stringify({ discordId: user.id, discordUsername: user.username }),
    }).catch(() => null);

    if (dbRes && !dbRes.ok) {
      const dbErr = await dbRes.json().catch(() => ({}));
      return json({ error: dbErr.error ?? 'Submission rejected' }, dbRes.status);
    }
  }

  // Post embed to Discord staff channel
  const discordRes = await fetch(
    `https://discord.com/api/v10/channels/${env.DISCORD_WHITELIST_CHANNEL}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
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

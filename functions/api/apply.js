const WHITELIST_CHANNEL = '1482373975316365472';
const TRANSPARENT_IMG  = 'https://pub-80ebeb36fdbb49b4966de28f8ce1b7a3.r2.dev/website/transparent-embed.png';

export async function onRequestPost({ request, env }) {
  // Parse cookies
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

  const botToken = (env.DISCORD_BOT_TOKEN || '').trim();

  // Helper: post one message to the channel
  async function postMessage(payload) {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${WHITELIST_CHANNEL}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      console.error('Discord API error:', err);
      throw new Error(err);
    }
    return res.json();
  }

  // Helper: split text into ≤4096-char chunks at word boundaries
  function splitText(text) {
    const LIMIT = 4096;
    const chunks = [];
    let remaining = text.trim();
    while (remaining.length > 0) {
      let slice = remaining.slice(0, LIMIT);
      if (remaining.length > LIMIT) {
        const lastSpace = slice.lastIndexOf(' ');
        if (lastSpace > 0) slice = slice.slice(0, lastSpace);
      }
      chunks.push(slice.trim());
      remaining = remaining.slice(slice.length).trim();
    }
    return chunks;
  }

  const components = [{
    type: 1,
    components: [
      { type: 2, style: 3, label: '✅  Accept', custom_id: `wl_accept_${user.id}` },
      { type: 2, style: 4, label: '❌  Reject', custom_id: `wl_reject_${user.id}` },
    ],
  }];

  try {
    // ── Message 1: Header info + buttons ────────────────────────────────────
    await postMessage({
      embeds: [{
        title: 'New Whitelist Application',
        color: 0x00aeff,
        thumbnail: { url: avatarUrl },
        image: { url: TRANSPARENT_IMG },
        timestamp: new Date().toISOString(),
        footer: { text: `Application from ${user.username}` },
        fields: [
          { name: 'Discord',       value: `<@${user.id}> (${user.username})`, inline: true },
          { name: 'Full Name',     value: fullname.trim(),                     inline: true },
          { name: '\u200B',        value: '\u200B',                            inline: false },
          { name: 'Date of Birth', value: dob.trim(),                         inline: true },
          { name: 'RP Experience', value: experience?.trim() || '*Not provided*', inline: true },
        ],
      }],
      components,
    });

    // ── Message 2: Character Concept ─────────────────────────────────────────
    const characterText = character?.trim() || '*Not provided*';
    const characterChunks = splitText(characterText);
    for (let i = 0; i < characterChunks.length; i++) {
      await postMessage({
        embeds: [{
          color: 0x00aeff,
          title: i === 0 ? 'Character Concept' : 'Character Concept (continued)',
          description: characterChunks[i],
          image: { url: TRANSPARENT_IMG },
        }],
      });
    }

    // ── Message 3: Why do you want to join ───────────────────────────────────
    const whyjoinChunks = splitText(whyjoin.trim());
    for (let i = 0; i < whyjoinChunks.length; i++) {
      await postMessage({
        embeds: [{
          color: 0x00aeff,
          title: i === 0 ? 'Why do you want to join Capital Roleplay?' : 'Why do you want to join? (continued)',
          description: whyjoinChunks[i],
          image: { url: TRANSPARENT_IMG },
        }],
      });
    }
  } catch {
    return json({ error: 'Failed to submit application — please try again' }, 500);
  }

  // Optional: duplicate check via bot API
  const botApiUrl = (env.BOT_API_URL || '').trim();
  if (botApiUrl) {
    try {
      const dbRes = await fetch(`${botApiUrl}/submit-application`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-secret': env.BOT_API_SECRET ?? '',
        },
        body: JSON.stringify({ discordId: user.id, discordUsername: user.username }),
        signal: AbortSignal.timeout(3000),
      });
      if (!dbRes.ok && dbRes.status === 409) {
        const dbErr = await dbRes.json().catch(() => ({}));
        return json({ error: dbErr.error ?? 'You already have a pending application' }, 409);
      }
    } catch {
      // Bot API unreachable — continue
    }
  }

  return json({ success: true }, 200);
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

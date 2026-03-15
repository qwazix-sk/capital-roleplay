const WHITELIST_ROLE  = '1478489840260747275';
const STAFF_CHANNEL   = '1482709760695599124';
const TRANSPARENT_IMG = 'https://pub-80ebeb36fdbb49b4966de28f8ce1b7a3.r2.dev/website/transparent-embed.png';

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

  // Check the applicant has the Whitelist role in the guild
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
    return json({ error: 'You must be a whitelisted member of Capital Roleplay before applying for staff.' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const { age, timezone, previous_experience, why_staff, why_choose, availability } = body;

  if (!age?.trim() || !timezone?.trim() || !why_staff?.trim() || !why_choose?.trim() || !availability?.trim()) {
    return json({ error: 'Please fill in all required fields' }, 400);
  }

  const whyStaffWords = why_staff.trim().split(/\s+/).filter(w => w.length > 0).length;
  if (whyStaffWords < 100) {
    return json({ error: `"Why do you want to be staff" must be at least 100 words (currently ${whyStaffWords})` }, 400);
  }

  const whyChooseWords = why_choose.trim().split(/\s+/).filter(w => w.length > 0).length;
  if (whyChooseWords < 50) {
    return json({ error: `"Why should we choose you" must be at least 50 words (currently ${whyChooseWords})` }, 400);
  }

  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;

  const botToken = (env.DISCORD_BOT_TOKEN || '').trim();

  // Helper: post one message to the channel
  async function postMessage(payload) {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${STAFF_CHANNEL}/messages`,
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
      { type: 2, style: 3, label: '✅  Accept', custom_id: `staff_accept_${user.id}` },
      { type: 2, style: 4, label: '❌  Reject', custom_id: `staff_reject_${user.id}` },
    ],
  }];

  try {
    // ── Message 1: Header info + buttons ────────────────────────────────────
    await postMessage({
      embeds: [{
        title: '📋 New Staff Application',
        color: 0xf5a623,
        thumbnail: { url: avatarUrl },
        image: { url: TRANSPARENT_IMG },
        timestamp: new Date().toISOString(),
        footer: { text: `Staff application from ${user.username}` },
        fields: [
          { name: 'Discord',             value: `<@${user.id}> (${user.username})`,     inline: true },
          { name: 'Age',                 value: age.trim(),                              inline: true },
          { name: 'Timezone',            value: timezone.trim(),                         inline: true },
          { name: 'Availability',        value: availability.trim(),                     inline: true },
          { name: 'Previous Experience', value: previous_experience?.trim() || '*Not provided*' },
        ],
      }],
      components,
    });

    // ── Message 2: Why do you want to be staff ───────────────────────────────
    const whyStaffChunks = splitText(why_staff.trim());
    for (let i = 0; i < whyStaffChunks.length; i++) {
      await postMessage({
        embeds: [{
          color: 0xf5a623,
          title: i === 0 ? 'Why do you want to be staff?' : 'Why do you want to be staff? (continued)',
          description: whyStaffChunks[i],
          image: { url: TRANSPARENT_IMG },
        }],
      });
    }

    // ── Message 3: Why should we choose you ──────────────────────────────────
    const whyChooseChunks = splitText(why_choose.trim());
    for (let i = 0; i < whyChooseChunks.length; i++) {
      await postMessage({
        embeds: [{
          color: 0xf5a623,
          title: i === 0 ? 'Why should we choose you over others?' : 'Why should we choose you? (continued)',
          description: whyChooseChunks[i],
          image: { url: TRANSPARENT_IMG },
        }],
      });
    }
  } catch {
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

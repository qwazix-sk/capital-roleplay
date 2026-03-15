const WHITELIST_ROLE = '1478489840260747275';
const STAFF_CHANNEL  = '1482709760695599124';
const DIV = '━'.repeat(49);

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

  const submittedAt = new Date().toUTCString().replace(' GMT', ' UTC');

  // ── Build the .txt file ──────────────────────────────────────────────────
  const fileContent = [
    DIV,
    '  STAFF APPLICATION — Capital Roleplay',
    DIV,
    '',
    `  Discord           : ${user.username} (${user.id})`,
    `  Age               : ${age.trim()}`,
    `  Timezone          : ${timezone.trim()}`,
    `  Availability      : ${availability.trim()}`,
    `  Previous Experience: ${previous_experience?.trim() || 'Not provided'}`,
    '',
    DIV,
    '  WHY DO YOU WANT TO BE STAFF?',
    DIV,
    '',
    why_staff.trim(),
    '',
    DIV,
    '  WHY SHOULD WE CHOOSE YOU OVER OTHERS?',
    DIV,
    '',
    why_choose.trim(),
    '',
    DIV,
    `  Submitted: ${submittedAt}`,
    DIV,
  ].join('\n');

  // ── Embed (short info only) ───────────────────────────────────────────────
  const embed = {
    title: '📋 New Staff Application',
    color: 0xf5a623,
    thumbnail: { url: avatarUrl },
    fields: [
      { name: 'Discord',      value: `<@${user.id}> (${user.username})`, inline: true },
      { name: 'Age',          value: age.trim(),                          inline: true },
      { name: 'Timezone',     value: timezone.trim(),                     inline: true },
      { name: 'Availability', value: availability.trim(),                 inline: true },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: `Staff application from ${user.username} · Full answers in attached file` },
  };

  const components = [{
    type: 1,
    components: [
      { type: 2, style: 3, label: '✅  Accept', custom_id: `staff_accept_${user.id}` },
      { type: 2, style: 4, label: '❌  Reject', custom_id: `staff_reject_${user.id}` },
    ],
  }];

  // ── Send via multipart/form-data with file attachment ────────────────────
  const formData = new FormData();
  formData.append('payload_json', JSON.stringify({ embeds: [embed], components }));
  formData.append(
    'files[0]',
    new Blob([fileContent], { type: 'text/plain' }),
    `staff-${user.username}.txt`
  );

  const discordRes = await fetch(
    `https://discord.com/api/v10/channels/${STAFF_CHANNEL}/messages`,
    {
      method: 'POST',
      headers: { Authorization: `Bot ${(env.DISCORD_BOT_TOKEN || '').trim()}` },
      body: formData,
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

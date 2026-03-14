export const prerender = false;

import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, cookies }) => {
  // Verify the user is authenticated
  const userCookie = cookies.get('dc_user');
  const tokenCookie = cookies.get('dc_token');

  if (!userCookie || !tokenCookie) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let user: { id: string; username: string; avatar: string | null };
  try {
    user = JSON.parse(userCookie.value);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid session' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify the token is still valid with Discord
  const verifyRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${tokenCookie.value}` },
  });
  if (!verifyRes.ok) {
    return new Response(JSON.stringify({ error: 'Session expired — please log in again' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await request.json();
  const { fullname, age, experience, character, whyjoin } = body;

  // Validate required fields
  if (!fullname?.trim() || !age || !experience || !whyjoin?.trim()) {
    return new Response(JSON.stringify({ error: 'Please fill in all required fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Enforce 100-word minimum on whyjoin
  const wordCount = whyjoin.trim().split(/\s+/).filter((w: string) => w.length > 0).length;
  if (wordCount < 100) {
    return new Response(
      JSON.stringify({ error: `"Why do you want to join" must be at least 100 words (currently ${wordCount})` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const channelId = import.meta.env.DISCORD_WHITELIST_CHANNEL;
  const botToken = import.meta.env.DISCORD_BOT_TOKEN;

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

  const components = [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          label: 'Accept',
          custom_id: `wl_accept_${user.id}`,
        },
        {
          type: 2,
          style: 4,
          label: 'Reject',
          custom_id: `wl_reject_${user.id}`,
        },
      ],
    },
  ];

  // Register the application in the bot's DB (duplicate/pending check)
  const botApiUrl = import.meta.env.BOT_API_URL;
  if (botApiUrl) {
    const dbRes = await fetch(`${botApiUrl}/submit-application`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': import.meta.env.BOT_API_SECRET,
      },
      body: JSON.stringify({ discordId: user.id, discordUsername: user.username }),
    }).catch(() => null);

    if (dbRes && !dbRes.ok) {
      const dbErr = await dbRes.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: dbErr.error ?? 'Submission failed' }), {
        status: dbRes.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const discordRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ embeds: [embed], components }),
  });

  if (!discordRes.ok) {
    const err = await discordRes.text();
    console.error('Discord API error:', err);
    return new Response(JSON.stringify({ error: 'Failed to submit application — please try again' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const base = url.origin;

  if (!code) return Response.redirect(`${base}/?error=oauth#apply`);

  // Exchange code for access token
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: (env.DISCORD_REDIRECT_URI || '').trim(),
    }),
  });

  if (!tokenRes.ok) return Response.redirect(`${base}/?error=oauth#apply`);
  const tokenData = await tokenRes.json();

  // Get user info
  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) return Response.redirect(`${base}/?error=oauth#apply`);
  const user = await userRes.json();

  const userPayload = encodeURIComponent(JSON.stringify({
    id: user.id,
    username: user.username,
    avatar: user.avatar ?? null,
  }));

  const maxAge = 60 * 60 * 24; // 24 hours
  const headers = new Headers({ Location: `${base}/#apply` });
  headers.append('Set-Cookie', `dc_user=${userPayload}; Path=/; Max-Age=${maxAge}; SameSite=Lax`);
  headers.append('Set-Cookie', `dc_token=${tokenData.access_token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`);

  return new Response(null, { status: 302, headers });
}

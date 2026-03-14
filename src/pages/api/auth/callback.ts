export const prerender = false;

import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const code = url.searchParams.get('code');
  if (!code) return redirect('/#apply');

  // Exchange code for access token
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: import.meta.env.DISCORD_CLIENT_ID,
      client_secret: import.meta.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: import.meta.env.DISCORD_REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) return redirect('/#apply?error=oauth');
  const tokenData = await tokenRes.json();

  // Get Discord user info
  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) return redirect('/#apply?error=oauth');
  const user = await userRes.json();

  cookies.set(
    'dc_user',
    JSON.stringify({
      id: user.id,
      username: user.username,
      avatar: user.avatar,
    }),
    {
      httpOnly: false, // readable by client JS to show username
      path: '/',
      maxAge: 60 * 60 * 24,
      sameSite: 'lax',
    }
  );

  // Store the access token in a separate httpOnly cookie
  cookies.set('dc_token', tokenData.access_token, {
    httpOnly: true,
    path: '/',
    maxAge: 60 * 60 * 24,
    sameSite: 'lax',
  });

  return redirect('/#apply');
};

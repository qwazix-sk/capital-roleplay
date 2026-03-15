export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  // Allow callers to pass ?from=/some/path so the callback can return them there
  const from = url.searchParams.get('from') || '/#apply';

  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: (env.DISCORD_REDIRECT_URI || '').trim(),
    response_type: 'code',
    scope: 'identify',
  });

  // Store the return path in a short-lived cookie so the callback can read it
  const headers = new Headers({
    Location: `https://discord.com/api/oauth2/authorize?${params}`,
  });
  headers.append('Set-Cookie', `dc_from=${encodeURIComponent(from)}; Path=/; Max-Age=600; SameSite=Lax`);

  return new Response(null, { status: 302, headers });
}

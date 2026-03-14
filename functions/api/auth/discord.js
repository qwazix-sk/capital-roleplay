export async function onRequestGet({ env }) {
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: (env.DISCORD_REDIRECT_URI || '').trim(),
    response_type: 'code',
    scope: 'identify',
  });
  return Response.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
}

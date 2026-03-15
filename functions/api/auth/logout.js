export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const base = url.origin;
  const from = url.searchParams.get('from') || '/#apply';
  const headers = new Headers({ Location: `${base}${from}` });
  headers.append('Set-Cookie', 'dc_user=; Path=/; Max-Age=0; SameSite=Lax');
  headers.append('Set-Cookie', 'dc_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  return new Response(null, { status: 302, headers });
}

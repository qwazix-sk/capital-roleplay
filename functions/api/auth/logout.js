export async function onRequestGet({ request }) {
  const base = new URL(request.url).origin;
  const headers = new Headers({ Location: `${base}/#apply` });
  headers.append('Set-Cookie', 'dc_user=; Path=/; Max-Age=0; SameSite=Lax');
  headers.append('Set-Cookie', 'dc_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  return new Response(null, { status: 302, headers });
}

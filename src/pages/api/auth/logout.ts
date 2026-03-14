export const prerender = false;

import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ cookies, redirect }) => {
  cookies.delete('dc_user', { path: '/' });
  cookies.delete('dc_token', { path: '/' });
  return redirect('/#apply');
};

/**
 * Vercel Routing Middleware: the same job as worker/index.ts on Cloudflare. Vercel serves the app's files, and
 * /api, /docs and /health are forwarded to the API server in the environment variable API_ORIGIN
 * (Vercel → this project → Settings → Environment Variables). Same address for both, so the app needs no
 * settings and there are no CORS problems.
 */
declare const process: { env: Record<string, string | undefined> };

export const config = { matcher: ['/api', '/api/:path*', '/docs', '/docs/:path*', '/health'] };

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ statusCode: status, message }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** Vercel calls this with (request, context): the API address always comes from the environment. */
export default function middleware(request: Request): Promise<Response> {
  return forward(request, process.env.API_ORIGIN);
}

export async function forward(request: Request, apiOrigin: string | undefined): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api' || url.pathname === '/api/') return Response.redirect(new URL('/api/v1', url).toString(), 302);

  const origin = (apiOrigin ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(origin)) {
    return json(503, 'The API address is not set: add the environment variable API_ORIGIN in Vercel (Settings → Environment Variables), then redeploy.');
  }
  const target = new URL(url.pathname + url.search, origin);
  const headers = new Headers(request.headers);
  headers.delete('host');
  // fetch() unpacks compressed bodies itself: ask for plain ones, and do not pass on a stale Content-Encoding
  headers.delete('accept-encoding');
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-Forwarded-Proto', 'https');
  try {
    const res = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
      redirect: 'manual',
    });
    const out = new Response(res.body, res);
    out.headers.delete('content-encoding');
    out.headers.delete('content-length');
    if (url.pathname.startsWith('/api/')) out.headers.set('Cache-Control', 'no-store');
    return out;
  } catch {
    return json(502, 'The API server did not answer. Is it running, and is API_ORIGIN correct?');
  }
}

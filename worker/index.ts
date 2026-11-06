/**
 * Cloudflare Worker in front of the web app: the app's files are served by Cloudflare (assets), and
 * /api, /docs and /health are forwarded to the API server in API_ORIGIN. Same address for both, so the
 * app needs no settings and there are no CORS problems.
 */
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** e.g. https://api.yourcafe.com or https://random-words.trycloudflare.com (no trailing slash) */
  API_ORIGIN?: string;
}

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ statusCode: status, message }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const toApi = url.pathname.startsWith('/api/') || url.pathname === '/docs' || url.pathname.startsWith('/docs/') || url.pathname === '/health';
    if (!toApi) return env.ASSETS.fetch(request);

    const origin = (env.API_ORIGIN ?? '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(origin)) {
      return json(503, 'The API address is not set: add the variable API_ORIGIN to this Worker (Settings → Variables and Secrets).');
    }
    const target = new URL(url.pathname + url.search, origin);
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.set('X-Forwarded-Host', url.host);
    headers.set('X-Forwarded-Proto', 'https');
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) headers.set('X-Forwarded-For', ip);
    try {
      const res = await fetch(target.toString(), {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'manual',
      });
      const out = new Response(res.body, res);
      if (url.pathname.startsWith('/api/')) out.headers.set('Cache-Control', 'no-store');
      return out;
    } catch {
      return json(502, 'The API server did not answer. Is it running, and is API_ORIGIN correct?');
    }
  },
};

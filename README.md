# POS System — Frontend (web app) 

The web app of a multi-store point of sale for shops and cafés, in one Vue app:

- **POS till** (`/pos`): barcode scanner, offline mode, receipts, riel cash, cashier controls, X/Z reports
- **Admin** (`/`): stores, products, stock, purchasing, promotions, coupons, wallet cards, users, reports
- **Café screens**: barista screen, order board, customer display
- **Online ordering** (`/order/<store>`): order ahead and table QR
- **Member app** (`/m`): points, wallet, history, order ahead
- English and **Khmer** interface

| Part | Technology |
|---|---|
| App | **Vue 3**, Vite, Pinia, Vue Router, PrimeVue 4, Chart.js |
| Hosting | **Vercel** (`vercel.json`, `middleware.ts`) or **Cloudflare Workers** (`wrangler.jsonc`, `worker/index.ts`) |
| API | the separate **pos-backend** project (NestJS + PostgreSQL + Redis) |

```
pos-frontend/
├── src/
│   ├── api/          fetch client (auto token refresh), shared types
│   ├── shared/       price, coupon and riel rules: copies of pos-backend files (npm run check:shared)
│   ├── stores/       Pinia: logged-in user, selected store
│   ├── layouts/      sidebar + top bar
│   ├── views/        one page per menu item
│   ├── pos/          POS till: cart, pricing, offline queue
│   ├── i18n/         English / Khmer
│   └── components/   charts, product search, date range, stat cards
├── worker/index.ts   Cloudflare Worker: serves the app, forwards /api, /docs, /health to API_ORIGIN
├── middleware.ts     the same forwarding on Vercel (vercel.json: build settings, page refreshes)
├── public/           service worker (offline POS), manifest, _headers
├── test/             browser tests (Playwright)
└── docs/FEATURES.md  how every part works
```

## Quick start (development)

Requirements: Node.js 20+, and **pos-backend running on http://localhost:3000** (see its README).

```bash
npm install
```

```bash
npm run dev
```

Open **http://localhost:5173**. In development, `/api` and `/docs` are forwarded to `http://localhost:3000`; to use
another API, set `VITE_API_PROXY` in `.env` (see `.env.example`).

Demo logins (password `Password@123`, from the pos-backend demo data): `admin@pos.local`, `manager.pp@pos.local`,
`cashier1@pos.local`. Cashiers go straight to the POS.

## Deploy to Vercel

1. Vercel → **Add New → Project** → import `cheaphearom/pos-frontend`. Vercel reads `vercel.json`: framework Vite,
   build `npm run build`, output `dist`. Root directory `/`.
2. **Settings → Environment Variables → Add** `API_ORIGIN` = the address of pos-backend, without a trailing slash,
   e.g. `https://api.yourcafe.com`, for Production (and Preview if you use it). Then **Deployments → Redeploy**: a
   variable takes effect on the next deployment.
3. Every push to `main` deploys again.
4. In pos-backend `deploy/.env`, add the app's address (e.g. `https://pos-frontend.vercel.app`) to `CORS_ORIGINS`.

`middleware.ts` forwards `/api`, `/docs` and `/health` to `API_ORIGIN`, so the app and the API share one address
(login cookies and no CORS problems). The API itself does **not** run on Vercel: it needs an always-on server for its
workers, PostgreSQL and Redis (a VPS with pos-backend's `deploy/`, or Railway / Render).

Check: `https://<your app>.vercel.app/health` should answer `ok` from the API. "API address is not set" means
`API_ORIGIN` is missing or the project was not redeployed; "The API server did not answer" means the API or its tunnel
is down. The address must be reachable from the internet: `http://192.168...` or `localhost` will not work (use a
Cloudflare Tunnel address while testing on your own computer).

## Deploy to Cloudflare Workers

1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository** → `cheaphearom/pos-frontend`.
   Root directory `/`, build command *empty*, deploy command `npx wrangler deploy` (it builds the app first).
   The Worker name must be the same as `"name"` in `wrangler.jsonc` (`pos-system`); change one of them if needed.
2. Worker → **Settings → Variables and Secrets → Add** `API_ORIGIN` = the address of pos-backend, without a trailing
   slash, e.g. `https://api.yourcafe.com`. Not a secret: it is only an address.
3. Every push to `main` builds and deploys again; `API_ORIGIN` is kept (`keep_vars`).
4. In pos-backend `deploy/.env`, add the app's address to `CORS_ORIGINS`.

Check: `https://<your worker>/health` should answer `ok` from the API. "API address is not set" means `API_ORIGIN` is
missing; "The API server did not answer" means the API or its tunnel is down.

From your computer instead: `npx wrangler login`, then `npm run deploy`.

## Rules shared with the backend

The POS works out totals offline with the same rules as the API. `src/shared/` holds copies of three pos-backend files:

| Here | pos-backend |
|---|---|
| `src/shared/promotions.ts` | `src/promotions/engine.ts` |
| `src/shared/coupons.ts` | `src/coupons/calc.ts` |
| `src/shared/cash.ts` | `src/sales/cash.ts` |

Change both together. With pos-backend cloned next to this folder, `npm run check:shared` says whether they match.

## Tests

The browser tests drive the real app with Playwright against the built app (`vite preview` on port 4173) and the API
on port 3000. Each suite changes stock, points and shifts, so the API needs **fresh demo data**: in pos-backend run
`npm run db:reset` and start the API first.

```bash
npm run build
```

```bash
npx vite preview --port 4173
```

```bash
npm run test:e2e
```

To run one suite: `node test/pos.e2e.cjs` (POS, café, bakery, online orders, member app, cashier controls, riel,
Khmer, X/Z, purchasing, promotions, KHQR, wallet, coupons each have their own file).

## Roles and access

| Role | Can do |
|---|---|
| **SUPER_ADMIN** | Everything in every store: stores, products, prices, users, API keys, webhooks |
| **STORE_MANAGER** | In their stores: stock, transfers, refunds, reports, store prices, manage cashiers |
| **CASHIER** | In their stores: sell, open and close their own shift, look up products and customers |

Every request is checked against the stores the user is assigned to. A cashier in PP01 cannot read or sell in SR01.

## More

- How every part works (POS, café mode, wallet, coupons, riel cash, X/Z reports, Khmer…): **[docs/FEATURES.md](docs/FEATURES.md)**
- API, database, integration API and server deployment: **pos-backend**

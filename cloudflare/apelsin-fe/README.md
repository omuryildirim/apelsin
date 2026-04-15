# apelsin-fe — Frontend Worker

React 19 + React Router 7 + Vite + Tailwind v4, served as SSR from a Cloudflare Worker via [@cloudflare/vite-plugin](https://www.npmjs.com/package/@cloudflare/vite-plugin).

Single-route SPA (all paths hit `routes/home.tsx`), with views switched in-memory and the URL kept in sync via `pushState`. See [CLAUDE.md](../../CLAUDE.md) for the full frontend structure.

## Environment variables

Vite build-time variables — must be set at `pnpm build`, not at runtime:

| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | API worker URL, e.g. `https://apelsin-api.yourdomain.com` |
| `VITE_WS_URL` | WebSocket URL, e.g. `wss://apelsin-ws.yourdomain.com` |
| `VITE_MEDIA_URL` | Media worker URL, e.g. `https://apelsin-media.yourdomain.com` |
| `VITE_VAPID_PUBLIC_KEY` | Same VAPID public key as in `aws/cdk/.env` |

Put them in `cloudflare/apelsin-fe/.env` for local dev, or export them before `pnpm build` in CI.

## Local development

```bash
pnpm install
pnpm dev
```

Runs on `http://localhost:5173`. Point the `VITE_*` variables at your deployed workers — there is no local backend.

## Deploy

```bash
pnpm install
pnpm build
wrangler deploy
```

The deploy target is configured in [wrangler.jsonc](wrangler.jsonc) (`name: apelsin-fe`). Add a custom domain in the Cloudflare dashboard under the worker's Triggers.

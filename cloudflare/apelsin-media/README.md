# apelsin-media — Media Proxy Worker

Edge-cached media delivery. Fronts the AWS Media API Gateway, verifying each request against the backend before serving and caching at the Cloudflare edge for one year. See [src/index.ts](src/index.ts).

## Request flow

1. Client fetches `GET /api/media/{key}` with `Authorization`, `X-Device-Id`, `X-User-Email` headers.
2. Worker POSTs those credentials plus `mediaKey` to `/api/auth/verify-media` on the AWS backend. The backend checks that the device session is valid **and** that the user is allowed to see this specific media (e.g. they're a participant in the chat).
3. If authorized, the worker checks its edge cache. On hit, it returns the cached bytes.
4. On miss, it fetches from the Media API Gateway, caches the response for one year (`Cache-Control: public, max-age=31536000, immutable`), and returns it.

Media keys are content-addressed (chat media is `chat-media/{chatId}/{uuid}`), so the one-year cache is safe — the bytes at a given key never change. The auth check happens on **every request**, even cache hits.

## Configuration

| Name | Kind | Description |
|---|---|---|
| `ORIGIN_HOST_NAME` | var | AWS Media API Gateway URL, e.g. `https://yyy.execute-api.eu-west-1.amazonaws.com` |
| `ORIGIN_SECRET` | secret | Must match the `ORIGIN_SECRET` in `aws/cdk/.env` |

## Deploy

```bash
pnpm install

wrangler secret put ORIGIN_SECRET
# paste the same value as aws/cdk/.env

wrangler deploy --var ORIGIN_HOST_NAME:https://YOUR_MEDIA_API_ID.execute-api.eu-west-1.amazonaws.com
```

Add a custom domain (e.g. `apelsin-media.yourdomain.com`) in the Cloudflare dashboard. The frontend's `VITE_MEDIA_URL` should point at this domain.

## Why a separate worker (not one big API worker)?

Media traffic has a very different shape from API traffic: large payloads, aggressive caching, no mutation. Keeping it in its own worker (and its own API Gateway on the AWS side) means:

- API traffic and media traffic can be throttled independently.
- A flood of media requests can't starve the control plane.
- The cache logic stays isolated from the CORS + origin-secret logic of the main API worker.

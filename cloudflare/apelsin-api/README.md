# apelsin-api — API Proxy Worker

Thin Cloudflare Worker that proxies HTTP requests to the AWS HTTP API Gateway. Its job is to:

1. Add CORS headers so the frontend (on a different subdomain) can call it.
2. Inject `X-Origin-Secret` on every request to AWS, so Lambdas reject anyone who bypasses the worker and hits API Gateway directly.

That's it. All application logic lives in the AWS Lambdas. See [src/index.ts](src/index.ts).

## Configuration

| Name | Kind | Description |
|---|---|---|
| `ORIGIN_HOST_NAME` | var | AWS HTTP API Gateway URL, e.g. `https://xxx.execute-api.eu-west-1.amazonaws.com` |
| `ORIGIN_SECRET` | secret | Must match the `ORIGIN_SECRET` in `aws/.env` |

Vars can be passed with `--var` at deploy time or set in [wrangler.jsonc](wrangler.jsonc). Secrets must be set via `wrangler secret put`.

## Deploy

```bash
pnpm install

wrangler secret put ORIGIN_SECRET
# paste the same value as aws/.env

wrangler deploy --var ORIGIN_HOST_NAME:https://YOUR_HTTP_API_ID.execute-api.eu-west-1.amazonaws.com
```

Add a custom domain (e.g. `apelsin-api.yourdomain.com`) in the Cloudflare dashboard under the worker's Triggers. The frontend's `VITE_API_BASE_URL` should point at this domain.

# AWS CDK — Apelsin Backend

The backend stack: HTTP API Gateway, Media API Gateway, WebSocket API Gateway, Lambdas, DynamoDB tables, and the private S3 bucket. All in one `ApelsinStack` defined in [lib/apelsin-stack.ts](lib/apelsin-stack.ts).

## Environment variables (`aws/.env`)

Loaded by [bin/apelsin.ts](bin/apelsin.ts) via `dotenv/config`.

| Variable | Required | Description |
|---|---|---|
| `VAPID_PUBLIC_KEY` | yes | Web push VAPID public key |
| `VAPID_PRIVATE_KEY` | yes | Web push VAPID private key |
| `VAPID_SUBJECT` | yes | VAPID subject, e.g. `mailto:you@example.com` |
| `WS_DOMAIN_NAME` | no | Custom domain for the WebSocket API, e.g. `apelsin-ws.yourdomain.com` |
| `ORIGIN_SECRET` | no | Shared secret with the Cloudflare Workers. Generate with `openssl rand -hex 32`. Lambdas reject requests without a matching `X-Origin-Secret` header |

Generate VAPID keys:

```bash
npx web-push generate-vapid-keys
```

## Deploy

```bash
cd aws
pnpm install
pnpm cdk bootstrap    # first time only, per AWS account + region
pnpm cdk deploy
```

CDK prints three URLs on success:

- `HttpApiUrl` — main API Gateway endpoint
- `MediaApiUrl` — media API Gateway endpoint
- `WsApiUrl` — WebSocket endpoint

If `WS_DOMAIN_NAME` is set, two more appear:

- `WsCustomDomainTarget` — CNAME target for Cloudflare DNS
- `WsCustomDomainUrl` — the custom `wss://…` URL to use as `VITE_WS_URL` in the frontend

## WebSocket custom domain (if `WS_DOMAIN_NAME` is set)

The first `cdk deploy` creates an ACM certificate and pauses for DNS validation. Add the validation CNAME from the deploy output to Cloudflare DNS. Once issued, add the target CNAME:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `_xxxxx.apelsin-ws` | `_yyyyy.acm-validations.aws` | DNS only (grey) |
| CNAME | `apelsin-ws` | value from `WsCustomDomainTarget` | DNS only (grey) |

Both records must be **DNS only (grey cloud)** — orange cloud breaks WebSocket upgrades and cert validation. The validation CNAME must stay permanently for automatic cert renewal.

## Cost guardrails

Two mechanisms bound the worst-case monthly bill even under sustained abuse. Both are $0 to configure.

**API Gateway throttling** — returns `429 Too Many Requests` before invoking any Lambda:

| API | Burst | Sustained |
|---|---|---|
| HTTP API (main) | 50 req | 25 req/s |
| Media API | 100 req | 50 req/s |

These are account-wide, not per-IP. Adjust in [lib/apelsin-stack.ts](lib/apelsin-stack.ts) if legitimate traffic exceeds them.

## Rotating the origin secret

1. `openssl rand -hex 32`
2. Update `aws/.env`
3. `pnpm cdk deploy` (updates all Lambda env vars)
4. Update both CF Workers: `wrangler secret put ORIGIN_SECRET` in each worker directory. Or, for GitHub Actions, update the `ORIGIN_SECRET` repo secret and redeploy.

There is a brief window (seconds) during steps 3–4 where the old secret is still being sent. Two ways to avoid downtime:

- **Update workers first:** they'll fail origin check until Lambdas catch up, but no data is lost.
- **Temporarily disable the check:** unset `ORIGIN_SECRET` in `.env`, deploy, then re-enable with the new value on both sides.

## Verify

- Direct hit to `HttpApiUrl` should return `{"error":"Forbidden"}` when `ORIGIN_SECRET` is set (confirms origin protection is active).
- Authenticated requests through the Cloudflare API worker should succeed.

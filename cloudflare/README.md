# Cloudflare Workers

Apelsin's edge layer. Three independent workers, each deployed from its own subdirectory:

- [apelsin-fe](apelsin-fe/README.md) — React frontend, SSR from a Worker
- [apelsin-api](apelsin-api/README.md) — thin HTTP proxy to the AWS main API Gateway
- [apelsin-media](apelsin-media/README.md) — edge-cached media proxy with per-request auth

Each has its own `wrangler.jsonc`, `package.json`, and can be deployed independently. CI/CD deploys only the workers whose directory changed — see [../.github/workflows/README.md](../.github/workflows/README.md).

For the overall architecture and why the stack is split between AWS and Cloudflare, see [../README.md](../README.md) and [../CLAUDE.md](../CLAUDE.md).

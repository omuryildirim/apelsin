interface Env {
	ORIGIN_HOST_NAME: string;
	ORIGIN_SECRET?: string;
}

const ONE_YEAR = 60 * 60 * 24 * 365;

const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, OPTIONS",
	"Access-Control-Allow-Headers": "Authorization, Content-Type, X-Device-Id, X-User-Email",
};


interface VerifyResponse {
	authorized: boolean;
	email?: string;
	reason?: string;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, { headers: CORS_HEADERS });
		}

		if (request.method !== "GET") {
			return new Response("Method not allowed", { status: 405 });
		}

		// ── Extract credentials ───────────────────────────────────────────────
		const authHeader = request.headers.get("Authorization") ?? "";
		const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
		const deviceId = request.headers.get("X-Device-Id") ?? "";
		const email = request.headers.get("X-User-Email") ?? "";

		if (!token || !deviceId || !email) {
			return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
		}

		// ── Extract media key from URL path ───────────────────────────────────
		const url = new URL(request.url);
		const mediaKey = url.pathname.replace(/^\/api\/media\//, "");

		if (!mediaKey) {
			return new Response("Not found", { status: 404, headers: CORS_HEADERS });
		}

		// ── Verify token + device + media access via backend ──────────────────
		const originHeaders: Record<string, string> = { "Content-Type": "application/json" };
		if (env.ORIGIN_SECRET) originHeaders["X-Origin-Secret"] = env.ORIGIN_SECRET;
		const verifyRes = await fetch(`${env.ORIGIN_HOST_NAME}/api/auth/verify-media`, {
			method: "POST",
			headers: originHeaders,
			body: JSON.stringify({ token, deviceId, email, mediaKey }),
		});

		if (!verifyRes.ok) {
			return new Response("Auth service error", { status: 502, headers: CORS_HEADERS });
		}

		const verify = await verifyRes.json() as VerifyResponse;

		if (!verify.authorized) {
			return new Response(verify.reason ?? "Forbidden", { status: 403, headers: CORS_HEADERS });
		}

		// ── Cache lookup (only after auth passes) ─────────────────────────────
		const cacheKey = new Request(request.url, { method: "GET" });
		const cache = caches.default;

		const cached = await cache.match(cacheKey);
		if (cached) {
			const resp = new Response(cached.body, cached);
			for (const [k, v] of Object.entries(CORS_HEADERS)) {
				resp.headers.set(k, v);
			}
			return resp;
		}

		// ── Fetch media from origin ───────────────────────────────────────────
		const originUrl = request.url.replace(url.origin, env.ORIGIN_HOST_NAME);

		const mediaHeaders: Record<string, string> = {
			Authorization: authHeader,
			"X-Device-Id": deviceId,
			"X-User-Email": email,
		};
		if (env.ORIGIN_SECRET) mediaHeaders["X-Origin-Secret"] = env.ORIGIN_SECRET;
		const originResponse = await fetch(originUrl, { headers: mediaHeaders });

		if (!originResponse.ok) {
			return new Response(originResponse.body, {
				status: originResponse.status,
				headers: CORS_HEADERS,
			});
		}

		// ── Build cacheable response ──────────────────────────────────────────
		const response = new Response(originResponse.body, originResponse);
		response.headers.set("Cache-Control", `public, max-age=${ONE_YEAR}, immutable`);
		for (const [k, v] of Object.entries(CORS_HEADERS)) {
			response.headers.set(k, v);
		}

		ctx.waitUntil(cache.put(cacheKey, response.clone()));

		return response;
	},
};

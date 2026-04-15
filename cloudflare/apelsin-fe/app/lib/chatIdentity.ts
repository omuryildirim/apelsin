export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

/** Canonical chat ID for DynamoDB: sorted pair of emails. */
export function chatIdFromPair(emailA: string, emailB: string): string {
	const a = normalizeEmail(emailA);
	const b = normalizeEmail(emailB);
	return [a, b].sort().join("__");
}

/** Short URL-safe hash from a chat ID. Deterministic. */
export async function chatHash(chatId: string): Promise<string> {
	const data = new TextEncoder().encode(chatId);
	const hash = await crypto.subtle.digest("SHA-256", data);
	const bytes = new Uint8Array(hash);
	// Take first 6 bytes → 8 base64url chars
	let str = "";
	for (let i = 0; i < 6; i++) {
		str += String.fromCharCode(bytes[i]!);
	}
	return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Synchronous short hash using a simple djb2-style hash. For URL generation without await. */
export function chatHashSync(chatId: string): string {
	let h = 5381;
	for (let i = 0; i < chatId.length; i++) {
		h = ((h << 5) + h + chatId.charCodeAt(i)) >>> 0;
	}
	return h.toString(36);
}

export interface Message {
	id: string;
	chatId: string;
	author: string;
	to?: string;
	type: "text" | "image" | "audio";
	text?: string;
	imageUrl?: string;
	audioUrl?: string;
	replyTo?: { id: string; author: string; text?: string };
	reactions?: Record<string, string[]>;
	timestamp: number;
}

export interface SignalMessage {
	type: "offer" | "answer" | "candidate" | "call-request" | "call-accept" | "call-reject" | "call-end";
	from: string;
	to: string;
	data: Record<string, unknown>;
	timestamp: number;
}

export interface MessagesMetadata {
	lastUpdateTime: number;
	messageCount: number;
}

export interface PublicKeyRequest {
	email: string;
	publicKeyJwk: JsonWebKey;
}

export interface PublicKeyResponse {
	email: string;
	publicKeyJwk: JsonWebKey;
}

export interface AuthResponse {
	message: string;
	userId: string;
	token: string;
	email: string;
	displayName: string;
}

export interface DeviceSession {
	deviceToken: string;
	deviceInfo: string;
	createdAt: number;
	lastActiveAt: number;
	isCurrent: boolean;
}

export interface ChatUser {
	userId: string;
	email: string;
	displayName?: string;
	photoUrl?: string;
}

export interface ContactRequest {
	email: string;
	displayName?: string;
	photoUrl?: string;
	requestedAt: number;
}

export interface UserProfile {
	email: string;
	displayName: string;
	photoUrl?: string;
}

// const API_BASE = "http://localhost:8787";
const API_BASE = import.meta.env.VITE_API_BASE_URL;
const MEDIA_BASE = import.meta.env.VITE_MEDIA_URL ?? API_BASE;

const SESSION_KEY = "apelsin_session";
const DEVICE_ID_KEY = "apelsin_device_id";

export function getDeviceId(): string {
	if (typeof localStorage === "undefined") return "";
	let id = localStorage.getItem(DEVICE_ID_KEY);
	if (!id) {
		id = crypto.randomUUID();
		localStorage.setItem(DEVICE_ID_KEY, id);
	}
	return id;
}

function authHeaders(): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"X-Device-Id": getDeviceId(),
	};
	try {
		const raw = localStorage.getItem(SESSION_KEY);
		if (raw) {
			const session = JSON.parse(raw) as { token?: string; email?: string };
			if (session.token) {
				headers.Authorization = `Bearer ${session.token}`;
			}
			if (session.email) {
				headers["X-User-Email"] = session.email;
			}
		}
	} catch { /* ignore */ }
	return headers;
}

export function isMobileDevice(): boolean {
	if (typeof navigator === "undefined") return false;
	return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function getDeviceInfo(): string {
	if (typeof navigator === "undefined") return "Unknown device";
	const ua = navigator.userAgent;
	if (/iPhone|iPad|iPod/.test(ua)) return `Safari on iOS`;
	if (/Android/.test(ua)) return `Chrome on Android`;
	if (/Mac OS/.test(ua)) return `${/Chrome/.test(ua) ? "Chrome" : "Safari"} on macOS`;
	if (/Windows/.test(ua)) return `${/Edg/.test(ua) ? "Edge" : "Chrome"} on Windows`;
	if (/Linux/.test(ua)) return `${/Firefox/.test(ua) ? "Firefox" : "Chrome"} on Linux`;
	return ua.slice(0, 80);
}

const blobCache = new Map<string, string>();

export async function fetchMediaBlob(
	path: string,
	decryptionKey?: CryptoKey,
): Promise<string> {
	if (!path) return "";

	const cacheKey = decryptionKey ? `enc:${path}` : path;
	const cached = blobCache.get(cacheKey);
	if (cached) return cached;

	const url = path.startsWith("http") ? path : `${MEDIA_BASE}${path}`;
	const headers: Record<string, string> = { "X-Device-Id": getDeviceId() };
	try {
		const raw = localStorage.getItem(SESSION_KEY);
		if (raw) {
			const session = JSON.parse(raw) as { token?: string; email?: string };
			if (session.token) {
				headers.Authorization = `Bearer ${session.token}`;
			}
			if (session.email) {
				headers["X-User-Email"] = session.email;
			}
		}
	} catch { /* ignore */ }

	const res = await fetch(url, { headers });
	if (!res.ok) return "";

	let blob: Blob;
	if (decryptionKey) {
		const { decryptBlob } = await import("./e2eEncryption");
		const encrypted = await res.arrayBuffer();
		const decrypted = await decryptBlob(encrypted, decryptionKey);
		blob = new Blob([decrypted]);
	} else {
		blob = await res.blob();
	}

	const blobUrl = URL.createObjectURL(blob);
	blobCache.set(cacheKey, blobUrl);
	return blobUrl;
}

export const api = {
	async getMessages(chatId: string): Promise<Message[]> {
		try {
			const res = await fetch(
				`${API_BASE}/api/messages?chatId=${encodeURIComponent(chatId)}`,
				{
					method: "GET",
					headers: authHeaders(),
				},
			);
			if (!res.ok) throw new Error("Failed to fetch messages");
			return res.json();
		} catch (error) {
			console.error("Error fetching messages:", error);
			return [];
		}
	},

	async checkMessages(): Promise<MessagesMetadata | null> {
		try {
			const res = await fetch(`${API_BASE}/api/messages/check`, {
				method: "GET",
				headers: authHeaders(),
			});
			if (!res.ok) throw new Error("Failed to check messages");
			return res.json();
		} catch (error) {
			console.error("Error checking messages:", error);
			return null;
		}
	},

	async getNewMessages(chatId: string, since: number): Promise<Message[]> {
		try {
			const res = await fetch(
				`${API_BASE}/api/messages?chatId=${encodeURIComponent(chatId)}&since=${since}`,
				{
					method: "GET",
					headers: authHeaders(),
				},
			);
			if (!res.ok) throw new Error("Failed to fetch new messages");
			return res.json();
		} catch (error) {
			console.error("Error fetching new messages:", error);
			return [];
		}
	},

	/**
	 * Subscribe to real-time message notifications via WebSocket.
	 * Calls onUpdate(messageId, timestamp) whenever the server pushes a notification.
	 * Auto-reconnects on disconnect.
	 */
	subscribeToMessages(
		email: string,
		onUpdate: (message: Message) => void,
		onPresence?: (from: string, presenceType: string) => void,
		onReaction?: (chatId: string, messageId: string, reactions: Record<string, string[]>) => void,
		onCall?: (from: string, callType: string, data: Record<string, unknown>) => void,
		onError?: (error: Error) => void,
	): { unsubscribe: () => void; sendWsMessage: (msg: Record<string, unknown>) => void } {
		const WS_URL = import.meta.env.VITE_WS_URL as string;

		let ws: WebSocket | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let closed = false;

		const connect = () => {
			if (closed) return;

			// Authenticate WebSocket with token + deviceId (verified by Lambda authorizer)
			const session = (() => {
				try {
					const raw = localStorage.getItem(SESSION_KEY);
					return raw ? JSON.parse(raw) as { token?: string } : null;
				} catch { return null; }
			})();
			const wsToken = session?.token ?? "";
			const wsDeviceId = getDeviceId();
			ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(wsToken)}&deviceId=${encodeURIComponent(wsDeviceId)}`);

			ws.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data as string) as Record<string, unknown>;

					if (data.type === "notification" && data.id) {
						const { type: _wsType, messageType, ...rest } = data;
						onUpdate({
							...rest,
							type: messageType ?? "text",
						} as unknown as Message);
					} else if (data.type === "presence" && data.from && data.presenceType) {
						onPresence?.(data.from as string, data.presenceType as string);
					} else if (data.type === "reaction" && data.chatId && data.messageId && data.reactions) {
						onReaction?.(data.chatId as string, data.messageId as string, data.reactions as Record<string, string[]>);
					} else if (data.type === "call" && data.from && data.callType) {
						onCall?.(data.from as string, data.callType as string, (data.data as Record<string, unknown>) ?? {});
					}
				} catch (error) {
					console.error("Error parsing WebSocket message:", error);
				}
			};

			ws.onerror = () => {
				if (onError) onError(new Error("WebSocket error"));
			};

			ws.onclose = () => {
				if (!closed) {
					reconnectTimer = setTimeout(connect, 3000);
				}
			};
		};

		connect();

		const unsubscribe = () => {
			closed = true;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			ws?.close();
		};

		const sendWsMessage = (msg: Record<string, unknown>) => {
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ ...msg, from: email }));
			}
		};

		return { unsubscribe, sendWsMessage };
	},

	async sendMessage(
		chatId: string,
		author: string,
		type: "text" | "image" | "audio",
		text?: string,
		imageUrl?: string,
		to?: string,
		audioUrl?: string,
		replyTo?: { id: string; author: string; text?: string },
	): Promise<Message | null> {
		try {
			const res = await fetch(`${API_BASE}/api/messages`, {
				method: "POST",
				headers: authHeaders(),
				body: JSON.stringify({
					chatId,
					author,
					to,
					type,
					text,
					imageUrl,
					audioUrl,
					replyTo,
					timestamp: Date.now(),
				}),
			});
			if (!res.ok) throw new Error("Failed to send message");
			return res.json();
		} catch (error) {
			console.error("Error sending message:", error);
			return null;
		}
	},

	async toggleReaction(chatId: string, sk: string, emoji: string): Promise<{ messageId: string; reactions: Record<string, string[]> } | null> {
		try {
			const res = await fetch(`${API_BASE}/api/messages/reactions`, {
				method: "PUT",
				headers: authHeaders(),
				body: JSON.stringify({ chatId, sk, emoji }),
			});
			if (!res.ok) return null;
			return res.json();
		} catch (error) {
			console.error("Error toggling reaction:", error);
			return null;
		}
	},

	async sendSignal(signal: SignalMessage): Promise<boolean> {
		try {
			const res = await fetch(`${API_BASE}/api/signal`, {
				method: "POST",
				headers: authHeaders(),
				body: JSON.stringify(signal),
			});
			return res.ok;
		} catch (error) {
			console.error("Error sending signal:", error);
			return false;
		}
	},

	async getSignals(peerId: string): Promise<SignalMessage[]> {
		try {
			const res = await fetch(`${API_BASE}/api/signal/${peerId}`, {
				method: "GET",
				headers: authHeaders(),
			});
			if (!res.ok) throw new Error("Failed to fetch signals");
			return res.json();
		} catch (error) {
			console.error("Error fetching signals:", error);
			return [];
		}
	},

	/**
	 * Share public key with the server (for E2E encryption key exchange)
	 */
	async sharePublicKey(
		email: string,
		publicKeyJwk: JsonWebKey,
	): Promise<boolean> {
		try {
			const res = await fetch(`${API_BASE}/api/users/public-key`, {
				method: "POST",
				headers: authHeaders(),
				body: JSON.stringify({ email, publicKeyJwk }),
			});
			return res.ok;
		} catch (error) {
			console.error("Error sharing public key:", error);
			return false;
		}
	},

	async getUserStatus(email: string): Promise<{ online: boolean; lastSeen?: number } | null> {
		try {
			const res = await fetch(`${API_BASE}/api/users/status/${encodeURIComponent(email)}`, {
				method: "GET",
				headers: authHeaders(),
			});
			if (!res.ok) return null;
			return res.json();
		} catch {
			return null;
		}
	},

	/**
	 * Get public key for another user (for E2E encryption)
	 */
	async getPublicKey(email: string): Promise<JsonWebKey | null> {
		try {
			const res = await fetch(`${API_BASE}/api/users/public-key/${encodeURIComponent(email)}`, {
				method: "GET",
				headers: authHeaders(),
			});
			if (!res.ok) return null;
			const data = (await res.json()) as PublicKeyResponse;
			return data.publicKeyJwk;
		} catch (error) {
			console.error("Error fetching public key:", error);
			return null;
		}
	},

	async register(
		email: string,
		displayName: string,
		password: string,
		publicKeyJwk: JsonWebKey,
	): Promise<AuthResponse> {
		const res = await fetch(`${API_BASE}/api/auth/register`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, displayName, password, publicKeyJwk, deviceInfo: getDeviceInfo(), deviceId: getDeviceId() }),
		});

		if (!res.ok) {
			const data = (await res.json().catch(() => ({}))) as { error?: string };
			throw new Error(data.error || "Failed to register user");
		}

		return res.json();
	},

	async login(email: string, password: string): Promise<AuthResponse> {
		const res = await fetch(`${API_BASE}/api/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, password, deviceInfo: getDeviceInfo(), deviceId: getDeviceId() }),
		});

		if (!res.ok) {
			const data = (await res.json().catch(() => ({}))) as { error?: string };
			throw new Error(data.error || "Failed to login");
		}

		return res.json();
	},

	async getProfile(email: string): Promise<UserProfile | null> {
		try {
			const res = await fetch(`${API_BASE}/api/profile/${encodeURIComponent(email)}`, {
				method: "GET",
				headers: authHeaders(),
			});
			if (!res.ok) return null;
			return res.json();
		} catch (error) {
			console.error("Error fetching profile:", error);
			return null;
		}
	},

	async updateProfile(email: string, displayName: string): Promise<boolean> {
		try {
			const res = await fetch(`${API_BASE}/api/profile`, {
				method: "PUT",
				headers: authHeaders(),
				body: JSON.stringify({ email, displayName }),
			});
			return res.ok;
		} catch (error) {
			console.error("Error updating profile:", error);
			return false;
		}
	},

	async getPhotoUploadUrl(email: string, contentType: string): Promise<{ uploadUrl: string; readUrl: string } | null> {
		try {
			const res = await fetch(`${API_BASE}/api/profile/photo-url`, {
				method: "POST",
				headers: authHeaders(),
				body: JSON.stringify({ email, contentType }),
			});
			if (!res.ok) return null;
			return res.json();
		} catch (error) {
			console.error("Error getting photo URL:", error);
			return null;
		}
	},

	async getChatMediaUploadUrl(chatId: string, contentType: string): Promise<{ uploadUrl: string; readUrl: string } | null> {
		try {
			const res = await fetch(`${API_BASE}/api/upload-url`, {
				method: "POST",
				headers: authHeaders(),
				body: JSON.stringify({ chatId, contentType }),
			});
			if (!res.ok) return null;
			return res.json();
		} catch (error) {
			console.error("Error getting upload URL:", error);
			return null;
		}
	},

	async getUsers(excludeEmail?: string): Promise<ChatUser[]> {
		try {
			const url = excludeEmail
				? `${API_BASE}/api/users?excludeEmail=${encodeURIComponent(excludeEmail)}`
				: `${API_BASE}/api/users`;
			const res = await fetch(url, {
				method: "GET",
				headers: authHeaders(),
			});
			if (!res.ok) throw new Error("Failed to fetch users");
			return res.json();
		} catch (error) {
			console.error("Error fetching users:", error);
			return [];
		}
	},

	async getContacts(): Promise<ChatUser[]> {
		try {
			const res = await fetch(`${API_BASE}/api/contacts`, {
				method: "GET",
				headers: authHeaders(),
			});
			if (!res.ok) return [];
			return res.json();
		} catch {
			return [];
		}
	},

	async getPendingRequests(): Promise<ContactRequest[]> {
		try {
			const res = await fetch(`${API_BASE}/api/contacts/pending`, {
				method: "GET",
				headers: authHeaders(),
			});
			if (!res.ok) return [];
			return res.json();
		} catch {
			return [];
		}
	},

	async sendContactRequest(email: string): Promise<{ message: string; status: string }> {
		const res = await fetch(`${API_BASE}/api/contacts`, {
			method: "POST",
			headers: authHeaders(),
			body: JSON.stringify({ email }),
		});
		if (!res.ok) {
			const data = (await res.json().catch(() => ({}))) as { error?: string };
			throw new Error(data.error || "Failed to send request");
		}
		return res.json();
	},

	async respondToRequest(email: string, action: "accept" | "decline"): Promise<boolean> {
		try {
			const res = await fetch(`${API_BASE}/api/contacts/${encodeURIComponent(email)}`, {
				method: "PUT",
				headers: authHeaders(),
				body: JSON.stringify({ action }),
			});
			return res.ok;
		} catch {
			return false;
		}
	},

	async pushSubscribe(subscription: PushSubscriptionJSON): Promise<boolean> {
		try {
			const res = await fetch(`${API_BASE}/api/push/subscribe`, {
				method: "POST",
				headers: authHeaders(),
				body: JSON.stringify({ subscription }),
			});
			return res.ok;
		} catch (error) {
			console.error("Error subscribing to push:", error);
			return false;
		}
	},

	async pushUnsubscribe(endpoint: string): Promise<boolean> {
		try {
			const res = await fetch(`${API_BASE}/api/push/unsubscribe`, {
				method: "POST",
				headers: authHeaders(),
				body: JSON.stringify({ endpoint }),
			});
			return res.ok;
		} catch (error) {
			console.error("Error unsubscribing from push:", error);
			return false;
		}
	},
	async createPairingSession(tempPublicKeyJwk: JsonWebKey): Promise<{ sessionId: string }> {
		const res = await fetch(`${API_BASE}/api/pairing`, {
			method: "POST",
			headers: authHeaders(),
			body: JSON.stringify({ tempPublicKeyJwk }),
		});
		if (!res.ok) throw new Error("Failed to create pairing session");
		return res.json();
	},

	async pollPairingSession(sessionId: string): Promise<{ status: string; encryptedKeyBlob?: string }> {
		const res = await fetch(`${API_BASE}/api/pairing/${encodeURIComponent(sessionId)}`, {
			method: "GET",
			headers: authHeaders(),
		});
		if (!res.ok) throw new Error("Failed to poll pairing session");
		return res.json();
	},

	async completePairingSession(sessionId: string, encryptedKeyBlob: string): Promise<boolean> {
		try {
			const res = await fetch(`${API_BASE}/api/pairing/${encodeURIComponent(sessionId)}`, {
				method: "POST",
				headers: authHeaders(),
				body: JSON.stringify({ encryptedKeyBlob }),
			});
			return res.ok;
		} catch (error) {
			console.error("Error completing pairing:", error);
			return false;
		}
	},

	async getDevices(): Promise<DeviceSession[]> {
		try {
			const res = await fetch(`${API_BASE}/api/auth/devices`, {
				method: "GET",
				headers: authHeaders(),
			});
			if (!res.ok) return [];
			return res.json();
		} catch {
			return [];
		}
	},

	async revokeDevice(deviceToken: string): Promise<boolean> {
		try {
			const res = await fetch(`${API_BASE}/api/auth/devices/${encodeURIComponent(deviceToken)}`, {
				method: "DELETE",
				headers: authHeaders(),
			});
			return res.ok;
		} catch {
			return false;
		}
	},

	async callRequest(to: string): Promise<boolean> {
		try {
			const res = await fetch(`${API_BASE}/api/call/request`, {
				method: "POST",
				headers: authHeaders(),
				body: JSON.stringify({ to }),
			});
			return res.ok;
		} catch {
			return false;
		}
	},

	async callCancel(to: string): Promise<boolean> {
		try {
			const res = await fetch(`${API_BASE}/api/call/cancel`, {
				method: "POST",
				headers: authHeaders(),
				body: JSON.stringify({ to }),
			});
			return res.ok;
		} catch {
			return false;
		}
	},
};

export const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;
